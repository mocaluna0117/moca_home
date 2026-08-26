import "server-only";

import { desc, eq, like, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  products,
  syncRuns,
  type Order,
  type OrderItem,
  type Product,
} from "@/lib/db/schema";

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

/** Orders newest-first; `q` filters by product name within the order. */
export function getOrders(q?: string): OrderWithItems[] {
  const term = q?.trim();

  const rows = term
    ? db
        .select()
        .from(orders)
        .where(
          sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${orders.id} and ${orderItems.productName} like ${"%" + term + "%"})`,
        )
        .orderBy(desc(orders.orderedAt))
        .all()
    : db.select().from(orders).orderBy(desc(orders.orderedAt)).all();

  if (rows.length === 0) return [];

  // One query for every item, then group in memory — 129 rows today, and it
  // keeps the N+1 out of the render path.
  const items = db.select().from(orderItems).all();
  const byOrder = new Map<string, OrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId);
    if (list) list.push(item);
    else byOrder.set(item.orderId, [item]);
  }

  return rows.map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
}

export interface ProductSummary {
  /** products.id when the site linked one, else null */
  productId: number | null;
  key: string;
  name: string;
  imageUrl: string | null;
  latestUnitPriceYen: number;
  orderCount: number;
  totalQuantity: number;
  lastOrderedAt: string;
  fetchStatus: Product["fetchStatus"] | null;
}

/**
 * Purchase history grouped by product. Deduped on product_id when present,
 * otherwise on the snapshot name (deleted products lose their link).
 */
export function getProductSummaries(q?: string): ProductSummary[] {
  const term = q?.trim();

  const rows = db
    .select({
      productId: orderItems.productId,
      productName: orderItems.productName,
      imageUrl: orderItems.imageUrl,
      unitPriceYen: orderItems.unitPriceYen,
      quantity: orderItems.quantity,
      orderedAt: orders.orderedAt,
      orderId: orderItems.orderId,
      productFetchStatus: products.fetchStatus,
      productName2: products.name,
      productImages: products.imageUrls,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(products, eq(products.id, orderItems.productId))
    .where(term ? like(orderItems.productName, `%${term}%`) : undefined)
    .orderBy(desc(orders.orderedAt))
    .all();

  const map = new Map<string, ProductSummary & { orderIds: Set<string> }>();

  for (const r of rows) {
    const key = r.productId !== null ? `p:${r.productId}` : `n:${r.productName}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalQuantity += r.quantity;
      existing.orderIds.add(r.orderId);
      existing.orderCount = existing.orderIds.size;
      continue;
    }
    map.set(key, {
      productId: r.productId,
      key,
      // rows are newest-first, so the first hit is the latest snapshot
      name: r.productName,
      imageUrl: r.imageUrl,
      latestUnitPriceYen: r.unitPriceYen,
      orderCount: 1,
      totalQuantity: r.quantity,
      lastOrderedAt: r.orderedAt,
      fetchStatus: r.productFetchStatus ?? null,
      orderIds: new Set([r.orderId]),
    });
  }

  return [...map.values()]
    .map((entry): ProductSummary => {
      const { orderIds, ...summary } = entry;
      void orderIds;
      return summary;
    })
    .sort((a, b) => (a.lastOrderedAt < b.lastOrderedAt ? 1 : -1));
}

export function getOrder(id: string): OrderWithItems | null {
  const order = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!order) return null;
  const items = db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .all();
  return { ...order, items };
}

export interface ProductDetail {
  product: Product | null;
  /** Snapshot fallback — always present if the product was ever purchased. */
  snapshot: {
    name: string;
    imageUrl: string | null;
    unitPriceYen: number;
  } | null;
  history: Array<{
    orderId: string;
    orderedAt: string;
    status: string;
    unitPriceYen: number;
    quantity: number;
  }>;
}

export function getProductDetail(id: number): ProductDetail {
  const product = db.select().from(products).where(eq(products.id, id)).get() ?? null;

  const history = db
    .select({
      orderId: orders.id,
      orderedAt: orders.orderedAt,
      status: orders.status,
      unitPriceYen: orderItems.unitPriceYen,
      quantity: orderItems.quantity,
      productName: orderItems.productName,
      imageUrl: orderItems.imageUrl,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(orderItems.productId, id))
    .orderBy(desc(orders.orderedAt))
    .all();

  const newest = history[0];

  return {
    product,
    snapshot: newest
      ? {
          name: newest.productName,
          imageUrl: newest.imageUrl,
          unitPriceYen: newest.unitPriceYen,
        }
      : null,
    history: history.map((h) => ({
      orderId: h.orderId,
      orderedAt: h.orderedAt,
      status: h.status,
      unitPriceYen: h.unitPriceYen,
      quantity: h.quantity,
    })),
  };
}

export function getStats() {
  const row = db
    .select({
      orderCount: sql<number>`count(distinct ${orders.id})`,
      itemCount: sql<number>`count(${orderItems.id})`,
      totalSpentYen: sql<number>`coalesce(sum(${orders.totalYen}), 0)`,
    })
    .from(orders)
    .get();

  const spent = db
    .select({ total: sql<number>`coalesce(sum(${orders.totalYen}), 0)` })
    .from(orders)
    .get();

  const items = db
    .select({ count: sql<number>`count(*)` })
    .from(orderItems)
    .get();

  return {
    orderCount: row?.orderCount ?? 0,
    itemCount: items?.count ?? 0,
    totalSpentYen: spent?.total ?? 0,
  };
}

export function getLastSync() {
  return (
    db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.status, "success"))
      .orderBy(desc(syncRuns.id))
      .get() ?? null
  );
}
