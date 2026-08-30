import "server-only";

import { eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { orderItems, orders, products } from "@/lib/db/schema";

import {
  HttpClient,
  LoginError,
  NotFoundError,
  ScraperError,
  loadConfig,
} from "./client";
import { login, withSession } from "./login";
import { fetchOrderDetail, fetchOrderListPage } from "./orders";
import { importShopFavorites } from "./favorites";
import { fetchProduct } from "./products";
import {
  SyncBusyError,
  assertNoActiveRun,
  beginRun,
  completeRun,
  failRun,
  heartbeat,
  setRunTotal,
} from "./runs";

export { SyncBusyError };

export type SyncProgress =
  | { phase: "login" }
  | { phase: "list"; page: number; lastPage: number }
  | { phase: "orders"; done: number; total: number }
  | { phase: "favorites"; seen: number }
  | { phase: "products"; done: number; total: number }
  | { phase: "done"; summary: SyncSummary };

export interface SyncSummary {
  totalOrders: number;
  ordersInserted: number;
  ordersDetailed: number;
  productsOk: number;
  productsNotFound: number;
  productsError: number;
  /** ショップから取り込んだお気に入り */
  favoritesSeen: number;
  favoritesAdded: number;
  /** ローカルで外していたため復活させなかった数 */
  favoritesSkipped: number;
}

const now = () => new Date().toISOString();

export async function runSync(
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncSummary> {
  const config = loadConfig();
  await assertNoActiveRun();

  const run = await beginRun("orders");

  const summary: SyncSummary = {
    totalOrders: 0,
    ordersInserted: 0,
    ordersDetailed: 0,
    productsOk: 0,
    productsNotFound: 0,
    productsError: 0,
    favoritesSeen: 0,
    favoritesAdded: 0,
    favoritesSkipped: 0,
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
    await setRunTotal(run.id, first.totalCount ?? null);
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
      (await db.select({ id: orders.id }).from(orders).all()).map((r) => r.id),
    );

    for (const order of listed.values()) {
      if (!existingIds.has(order.id)) summary.ordersInserted++;
      await db
        .insert(orders)
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
    const pending = (
      await db
        .select({ id: orders.id })
        .from(orders)
        .where(isNull(orders.detailFetchedAt))
        .all()
    ).map((r) => r.id);

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

      await db.transaction(async (tx) => {
        await tx
          .update(orders)
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
          await tx
            .insert(products)
            .values({ id: item.productId, fetchStatus: "pending" })
            .onConflictDoNothing()
            .run();
        }

        // No natural key for a line item — replace the set wholesale.
        await tx.delete(orderItems).where(eq(orderItems.orderId, orderId)).run();
        for (const item of items) {
          await tx
            .insert(orderItems)
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
      await heartbeat(run.id, summary.ordersDetailed);
      onProgress?.({ phase: "orders", done: index + 1, total });
    }

    // --- phase 2.5: ショップのお気に入りを取り込む
    // 商品エンリッチ(phase 3)の *前* に置くのが要点。未知の商品IDに
    // products スタブを作るので、同じ実行の中で名前と画像まで埋まる。
    // 追加リクエストは1ページ = 1回だけ。
    try {
      const fav = await withSession(client, config, () =>
        importShopFavorites(client),
      );
      summary.favoritesSeen = fav.seen;
      summary.favoritesAdded = fav.added;
      summary.favoritesSkipped = fav.skipped;
      onProgress?.({ phase: "favorites", seen: fav.seen });
    } catch (err) {
      // お気に入りは補助情報。取得できなくても同期全体は止めない
      console.warn(
        `お気に入りの取り込みに失敗しました: ${err instanceof Error ? err.message : err}`,
      );
    }

    // --- phase 3: product enrichment (never retries known-gone products)
    const productQueue = (
      await db
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.fetchStatus, ["pending", "error"]))
        .all()
    ).map((r) => r.id);

    onProgress?.({ phase: "products", done: 0, total: productQueue.length });

    for (const [index, productId] of productQueue.entries()) {
      try {
        const parsed = await fetchProduct(client, productId);
        await db
          .update(products)
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
        await db
          .update(products)
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
      await heartbeat(run.id, summary.ordersDetailed);
      onProgress?.({
        phase: "products",
        done: index + 1,
        total: productQueue.length,
      });
    }

    await completeRun(run.id, {
      total: summary.totalOrders,
      processed: summary.ordersDetailed,
    });

    onProgress?.({ phase: "done", summary });
    return summary;
  } catch (err) {
    const message =
      err instanceof LoginError || err instanceof ScraperError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    await failRun(run.id, message);
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
