import "server-only";

import { desc, eq, like, sql } from "drizzle-orm";

import {
  computeOrderBonuses,
  parseBonusRule,
  type BonusRule,
  type ItemBonusResult,
  type OrderBonusResult,
} from "@/lib/bonus";
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

export interface OrderItemWithBonus extends OrderItem {
  bonus: ItemBonusResult;
}

export interface OrderWithItems extends Order {
  items: OrderItemWithBonus[];
  bonuses: OrderBonusResult;
}

/** Zip computeOrderBonuses results (parallel by index) onto the item rows. */
function withBonuses(order: Order, items: OrderItem[]): OrderWithItems {
  const bonuses = computeOrderBonuses(items);
  return {
    ...order,
    items: items.map((item, i) => ({ ...item, bonus: bonuses.items[i] })),
    bonuses,
  };
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

  return rows.map((o) => withBonuses(o, byOrder.get(o.id) ?? []));
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
  bonusRule: BonusRule | null;
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
      bonusRule: parseBonusRule(r.productName),
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
  return withBonuses(order, items);
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
    bonus: ItemBonusResult | null;
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

  // Activation depends on each order's FULL item set (pooling), so pull the
  // sibling items of every order in the history and compute per order.
  const historyOrderIds = new Set(history.map((h) => h.orderId));
  const siblingItems = db
    .select()
    .from(orderItems)
    .all()
    .filter((i) => historyOrderIds.has(i.orderId));
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of siblingItems) {
    const list = itemsByOrder.get(item.orderId);
    if (list) list.push(item);
    else itemsByOrder.set(item.orderId, [item]);
  }
  const bonusForOrder = new Map<string, ItemBonusResult | null>();
  for (const [orderId, items] of itemsByOrder) {
    const result = computeOrderBonuses(items);
    const idx = items.findIndex((i) => i.productId === id);
    bonusForOrder.set(orderId, idx >= 0 ? result.items[idx] : null);
  }

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
      bonus: bonusForOrder.get(h.orderId) ?? null,
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
