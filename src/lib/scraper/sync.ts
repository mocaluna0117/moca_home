import "server-only";

import { eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders, products, syncRuns } from "@/lib/db/schema";

import {
  HttpClient,
  LoginError,
  NotFoundError,
  ScraperError,
  loadConfig,
} from "./client";
import { login, withSession } from "./login";
import { fetchOrderDetail, fetchOrderListPage } from "./orders";
import { fetchProduct } from "./products";

export type SyncProgress =
  | { phase: "login" }
  | { phase: "list"; page: number; lastPage: number }
  | { phase: "orders"; done: number; total: number }
  | { phase: "products"; done: number; total: number }
  | { phase: "done"; summary: SyncSummary };

export interface SyncSummary {
  totalOrders: number;
  ordersInserted: number;
  ordersDetailed: number;
  productsOk: number;
  productsNotFound: number;
  productsError: number;
}

export class SyncBusyError extends ScraperError {}

const now = () => new Date().toISOString();

/** A run older than this is treated as crashed, not active. */
const STALE_RUN_MS = 10 * 60 * 1000;

function assertNoActiveRun() {
  const running = db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"))
    .all();
  for (const run of running) {
    const age = Date.now() - new Date(run.startedAt).getTime();
    if (Number.isFinite(age) && age < STALE_RUN_MS) {
      throw new SyncBusyError("同期が既に実行中です");
    }
    // Crashed run — close it out so it stops blocking.
    db.update(syncRuns)
      .set({
        status: "error",
        finishedAt: now(),
        errorMessage: "中断されました（タイムアウト）",
      })
      .where(eq(syncRuns.id, run.id))
      .run();
  }
}

export async function runSync(
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncSummary> {
  const config = loadConfig();
  assertNoActiveRun();

  const run = db
    .insert(syncRuns)
    .values({ startedAt: now(), status: "running" })
    .returning()
    .get();

  const summary: SyncSummary = {
    totalOrders: 0,
    ordersInserted: 0,
    ordersDetailed: 0,
    productsOk: 0,
    productsNotFound: 0,
    productsError: 0,
  };

  try {
    const client = new HttpClient(config);

    onProgress?.({ phase: "login" });
    await login(client, config);

    // --- phase 1: all list pages (cheap; keeps status fresh for every order)
    const first = await withSession(client, config, () =>
      fetchOrderListPage(client, 1),
    );
    const lastPage = first.lastPage;
    db.update(syncRuns)
      .set({ totalOrders: first.totalCount ?? null })
      .where(eq(syncRuns.id, run.id))
      .run();
    onProgress?.({ phase: "list", page: 1, lastPage });

    const listed = new Map<string, (typeof first.orders)[number]>();
    for (const o of first.orders) listed.set(o.id, o);

    for (let page = 2; page <= lastPage; page++) {
      const parsed = await withSession(client, config, () =>
        fetchOrderListPage(client, page),
      );
      onProgress?.({ phase: "list", page, lastPage });
      let fresh = 0;
      for (const o of parsed.orders) {
        if (!listed.has(o.id)) fresh++;
        listed.set(o.id, o);
      }
      // Defensive: an unexpectedly repeated page means pagination is broken.
      if (fresh === 0) break;
    }

    summary.totalOrders = listed.size;

    const existingIds = new Set(
      db
        .select({ id: orders.id })
        .from(orders)
        .all()
        .map((r) => r.id),
    );

    for (const order of listed.values()) {
      if (!existingIds.has(order.id)) summary.ordersInserted++;
      db.insert(orders)
        .values({
          id: order.id,
          orderedAt: order.orderedAt,
          status: order.status,
          updatedAt: now(),
        })
        .onConflictDoUpdate({
          target: orders.id,
          set: {
            orderedAt: order.orderedAt,
            status: order.status,
            updatedAt: now(),
          },
        })
        .run();
    }

    // --- phase 2: order details, only for orders never detailed before
    const pending = db
      .select({ id: orders.id })
      .from(orders)
      .where(isNull(orders.detailFetchedAt))
      .all()
      .map((r) => r.id);

    const total = pending.length;
    onProgress?.({ phase: "orders", done: 0, total });

    for (const [index, orderId] of pending.entries()) {
      const detail = await withSession(client, config, () =>
        fetchOrderDetail(client, orderId),
      );
      const listItems = listed.get(orderId)?.items ?? [];
      // Prefer the detail page (it carries product ids); fall back to the list
      // snapshot if the detail page yielded no items.
      const items = detail.items.length
        ? detail.items
        : listItems.map((i) => ({ ...i, productId: null }));

      db.transaction((tx) => {
        tx.update(orders)
          .set({
            orderedAt: detail.orderedAt ?? listed.get(orderId)?.orderedAt,
            status: detail.status ?? undefined,
            subtotalYen: detail.subtotalYen,
            feeYen: detail.feeYen,
            shippingFeeYen: detail.shippingFeeYen,
            totalYen: detail.totalYen,
            shippingMethod: detail.shippingMethod,
            detailFetchedAt: now(),
            updatedAt: now(),
          })
          .where(eq(orders.id, orderId))
          .run();

        // Product stubs must exist before order_items can reference them.
        for (const item of items) {
          if (item.productId === null) continue;
          tx.insert(products)
            .values({ id: item.productId, fetchStatus: "pending" })
            .onConflictDoNothing()
            .run();
        }

        // No natural key for a line item — replace the set wholesale.
        tx.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
        for (const item of items) {
          tx.insert(orderItems)
            .values({
              orderId,
              productId: item.productId,
              productName: item.productName,
              imageUrl: item.imageUrl,
              unitPriceYen: item.unitPriceYen,
              quantity: item.quantity,
            })
            .run();
        }
      });

      summary.ordersDetailed++;
      db.update(syncRuns)
        .set({ ordersProcessed: summary.ordersDetailed })
        .where(eq(syncRuns.id, run.id))
        .run();
      onProgress?.({ phase: "orders", done: index + 1, total });
    }

    // --- phase 3: product enrichment (never retries known-gone products)
    const productQueue = db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.fetchStatus, ["pending", "error"]))
      .all()
      .map((r) => r.id);

    onProgress?.({ phase: "products", done: 0, total: productQueue.length });

    for (const [index, productId] of productQueue.entries()) {
      try {
        const parsed = await fetchProduct(client, productId);
        db.update(products)
          .set({
            name: parsed.name,
            priceYen: parsed.priceYen,
            descriptionHtml: parsed.descriptionHtml,
            category: parsed.category,
            tags: JSON.stringify(parsed.tags),
            imageUrls: JSON.stringify(parsed.imageUrls),
            fetchStatus: "ok",
            fetchedAt: now(),
            updatedAt: now(),
          })
          .where(eq(products.id, productId))
          .run();
        summary.productsOk++;
      } catch (err) {
        const gone = err instanceof NotFoundError;
        db.update(products)
          .set({
            fetchStatus: gone ? "not_found" : "error",
            fetchedAt: now(),
            updatedAt: now(),
          })
          .where(eq(products.id, productId))
          .run();
        if (gone) summary.productsNotFound++;
        else summary.productsError++;
      }
      onProgress?.({
        phase: "products",
        done: index + 1,
        total: productQueue.length,
      });
    }

    db.update(syncRuns)
      .set({
        status: "success",
        finishedAt: now(),
        totalOrders: summary.totalOrders,
        ordersProcessed: summary.ordersDetailed,
      })
      .where(eq(syncRuns.id, run.id))
      .run();

    onProgress?.({ phase: "done", summary });
    return summary;
  } catch (err) {
    const message =
      err instanceof LoginError || err instanceof ScraperError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    db.update(syncRuns)
      .set({ status: "error", finishedAt: now(), errorMessage: message })
      .where(eq(syncRuns.id, run.id))
      .run();
    throw err;
  }
}

/** Login-only probe used by `npm run sync -- --login-only`. */
export async function probeLogin() {
  const config = loadConfig();
  const client = new HttpClient(config);
  await login(client, config);
  const page = await fetchOrderListPage(client, 1);
  return {
    totalCount: page.totalCount,
    lastPage: page.lastPage,
    firstPageOrders: page.orders.length,
    newestOrderId: page.orders[0]?.id ?? null,
  };
}
