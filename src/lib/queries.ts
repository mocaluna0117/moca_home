import "server-only";

import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

import {
  computeOrderBonuses,
  parseBonusRule,
  type BonusRule,
  type ItemBonusResult,
  type OrderBonusResult,
} from "@/lib/bonus";
import { db } from "@/lib/db";
import { parseJsonArray } from "@/lib/format";
import {
  orderItems,
  orders,
  productFavorites,
  products,
  receivedBonuses,
  syncRuns,
  type Order,
  type OrderItem,
  type FavoriteSource,
  type Product,
  type ReceivedBonus,
} from "@/lib/db/schema";

export interface OrderItemWithBonus extends OrderItem {
  bonus: ItemBonusResult;
}

export interface ReceivedBonusRow extends ReceivedBonus {
  /** first products.image_urls entry when product_id is set */
  imageUrl: string | null;
}

export interface OrderWithItems extends Order {
  items: OrderItemWithBonus[];
  bonuses: OrderBonusResult;
  /** Manually recorded actuals — take display precedence over predictions. */
  receivedBonuses: ReceivedBonusRow[];
  /** Σ quantity of recorded actuals (0 = none recorded). */
  receivedTotal: number;
}

function firstImage(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && typeof arr[0] === "string" ? arr[0] : null;
  } catch {
    return null;
  }
}

/** One bulk query; grouped in memory (same idiom as the items grouping). */
async function fetchReceivedByOrder(
  orderId?: string,
): Promise<Map<string, ReceivedBonusRow[]>> {
  const rows = await db
    .select({
      row: receivedBonuses,
      productImages: products.imageUrls,
    })
    .from(receivedBonuses)
    .leftJoin(products, eq(products.id, receivedBonuses.productId))
    .where(orderId ? eq(receivedBonuses.orderId, orderId) : undefined)
    .orderBy(receivedBonuses.id)
    .all();
  const map = new Map<string, ReceivedBonusRow[]>();
  for (const r of rows) {
    const entry: ReceivedBonusRow = { ...r.row, imageUrl: firstImage(r.productImages) };
    const list = map.get(entry.orderId);
    if (list) list.push(entry);
    else map.set(entry.orderId, [entry]);
  }
  return map;
}

/** Zip computeOrderBonuses results (parallel by index) onto the item rows. */
function withBonuses(
  order: Order,
  items: OrderItem[],
  received: ReceivedBonusRow[],
): OrderWithItems {
  const bonuses = computeOrderBonuses(items);
  return {
    ...order,
    items: items.map((item, i) => ({ ...item, bonus: bonuses.items[i] })),
    bonuses,
    receivedBonuses: received,
    receivedTotal: received.reduce((n, r) => n + r.quantity, 0),
  };
}

/** Orders newest-first; `q` filters by product name within the order. */
export async function getOrders(q?: string): Promise<OrderWithItems[]> {
  const term = q?.trim();

  const rows = term
    ? await db
        .select()
        .from(orders)
        .where(
          sql`exists (select 1 from ${orderItems} where ${orderItems.orderId} = ${orders.id} and ${orderItems.productName} like ${"%" + term + "%"})`,
        )
        .orderBy(desc(orders.orderedAt))
        .all()
    : await db.select().from(orders).orderBy(desc(orders.orderedAt)).all();

  if (rows.length === 0) return [];

  // One query for every item, then group in memory — 129 rows today, and it
  // keeps the N+1 out of the render path.
  const items = await db.select().from(orderItems).all();
  const byOrder = new Map<string, OrderItem[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId);
    if (list) list.push(item);
    else byOrder.set(item.orderId, [item]);
  }

  const receivedByOrder = await fetchReceivedByOrder();
  return rows.map((o) =>
    withBonuses(o, byOrder.get(o.id) ?? [], receivedByOrder.get(o.id) ?? []),
  );
}

/** 星がついている商品ID。数行なので毎回引いてよい。 */
export async function getFavoriteProductIds(): Promise<Set<number>> {
  const rows = await db
    .select({ productId: productFavorites.productId })
    .from(productFavorites)
    .where(eq(productFavorites.starred, true))
    .all();
  return new Set(rows.map((r) => r.productId));
}

export interface ProductSummary {
  /** products.id when the site linked one, else null */
  productId: number | null;
  key: string;
  name: string;
  imageUrl: string | null;
  /** null for free-text freebies — no price exists for them. */
  latestUnitPriceYen: number | null;
  orderCount: number;
  totalQuantity: number;
  lastOrderedAt: string;
  fetchStatus: Product["fetchStatus"] | null;
  bonusRule: BonusRule | null;
  /** Σ quantity of this product recorded as a received freebie. */
  receivedCount: number;
  /** true when the product only ever arrived as a freebie (never purchased). */
  freebieOnly: boolean;
  /** アプリ内お気に入り。自由入力行（product_id なし）は常に false。 */
  isFavorite: boolean;
}

/**
 * Purchase history grouped by product. Deduped on product_id when present,
 * otherwise on the snapshot name (deleted products lose their link).
 */
export async function getProductSummaries(
  q?: string,
  opts?: { favoritesOnly?: boolean },
): Promise<ProductSummary[]> {
  const term = q?.trim();
  // 追加は1本、返るのは数行。既存の grouping の中で参照するだけ。
  const favoriteIds = await getFavoriteProductIds();

  const rows = await db
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
      receivedCount: 0,
      freebieOnly: false,
      isFavorite: r.productId !== null && favoriteIds.has(r.productId),
      orderIds: new Set([r.orderId]),
    });
  }

  // Fold in recorded freebies: they add a 「おまけ N点」 counter to products
  // already purchased, and appear as freebie-only entries otherwise.
  const freebies = await db
    .select({
      productId: receivedBonuses.productId,
      label: receivedBonuses.label,
      quantity: receivedBonuses.quantity,
      orderedAt: orders.orderedAt,
      productImages: products.imageUrls,
      productPriceYen: products.priceYen,
      productFetchStatus: products.fetchStatus,
    })
    .from(receivedBonuses)
    .innerJoin(orders, eq(orders.id, receivedBonuses.orderId))
    .leftJoin(products, eq(products.id, receivedBonuses.productId))
    .where(term ? like(receivedBonuses.label, `%${term}%`) : undefined)
    .orderBy(desc(orders.orderedAt))
    .all();

  for (const f of freebies) {
    const key = f.productId !== null ? `p:${f.productId}` : `n:${f.label}`;
    const existing = map.get(key);
    if (existing) {
      existing.receivedCount += f.quantity;
      if (f.orderedAt > existing.lastOrderedAt) existing.lastOrderedAt = f.orderedAt;
      continue;
    }
    map.set(key, {
      productId: f.productId,
      key,
      name: f.label,
      imageUrl: firstImage(f.productImages),
      latestUnitPriceYen: f.productPriceYen ?? null,
      orderCount: 0,
      totalQuantity: 0,
      lastOrderedAt: f.orderedAt,
      fetchStatus: f.productFetchStatus ?? null,
      bonusRule: parseBonusRule(f.label),
      receivedCount: f.quantity,
      freebieOnly: true,
      isFavorite: f.productId !== null && favoriteIds.has(f.productId),
      orderIds: new Set(),
    });
  }

  const list = [...map.values()]
    .map((entry): ProductSummary => {
      const { orderIds, ...summary } = entry;
      void orderIds;
      return summary;
    })
    .sort((a, b) => (a.lastOrderedAt < b.lastOrderedAt ? 1 : -1));

  // 絞り込みはメモリで。この配列は order_items と received_bonuses の
  // 2クエリから合流するので、SQL 側で絞ると両方に条件を撒く羽目になる。
  return opts?.favoritesOnly ? list.filter((s) => s.isFavorite) : list;
}

export interface FavoriteProduct {
  productId: number;
  name: string;
  imageUrl: string | null;
  priceYen: number | null;
  fetchStatus: Product["fetchStatus"] | null;
  bonusRule: BonusRule | null;
  /** 星をつけた瞬間（並び順の軸） */
  starredAt: string | null;
  /** 最後の取り込み時点でショップのお気に入りにも入っていた */
  inShop: boolean;
  source: FavoriteSource;
  /** 未購入なら 0 / null */
  orderCount: number;
  totalQuantity: number;
  lastOrderedAt: string | null;
}

/**
 * お気に入り一覧。星はカタログ全体に付くので order_items からは組めない
 * （買ったことのない商品が主役になりうる）。起点は product_favorites。
 */
export async function getFavorites(): Promise<FavoriteProduct[]> {
  const rows = await db
    .select({
      productId: productFavorites.productId,
      starredAt: productFavorites.starredAt,
      inShop: productFavorites.shopFavorite,
      source: productFavorites.source,
      name: products.name,
      priceYen: products.priceYen,
      imageUrls: products.imageUrls,
      fetchStatus: products.fetchStatus,
    })
    .from(productFavorites)
    .leftJoin(products, eq(products.id, productFavorites.productId))
    .where(eq(productFavorites.starred, true))
    .orderBy(desc(productFavorites.starredAt))
    .all();
  if (rows.length === 0) return [];

  // 購入実績は集計1本を左から貼る（N+1にしない）
  const stats = await db
    .select({
      productId: orderItems.productId,
      orderCount: sql<number>`count(distinct ${orderItems.orderId})`,
      totalQuantity: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
      lastOrderedAt: sql<string>`max(${orders.orderedAt})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      inArray(
        orderItems.productId,
        rows.map((r) => r.productId),
      ),
    )
    .groupBy(orderItems.productId)
    .all();
  const byProduct = new Map(stats.map((s) => [s.productId, s]));

  return rows.map((r) => {
    const st = byProduct.get(r.productId);
    const name = r.name ?? `商品 ${r.productId}`;
    return {
      productId: r.productId,
      name,
      imageUrl: firstImage(r.imageUrls),
      priceYen: r.priceYen,
      fetchStatus: r.fetchStatus,
      bonusRule: parseBonusRule(name),
      starredAt: r.starredAt,
      inShop: r.inShop,
      source: r.source,
      orderCount: Number(st?.orderCount ?? 0),
      totalQuantity: Number(st?.totalQuantity ?? 0),
      lastOrderedAt: st?.lastOrderedAt ?? null,
    };
  });
}

export async function getOrder(id: string): Promise<OrderWithItems | null> {
  const order = await db.select().from(orders).where(eq(orders.id, id)).get();
  if (!order) return null;
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .all();
  const received = (await fetchReceivedByOrder(id)).get(id) ?? [];
  return withBonuses(order, items, received);
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

export async function getProductDetail(id: number): Promise<ProductDetail> {
  const product =
    (await db.select().from(products).where(eq(products.id, id)).get()) ?? null;

  const history = await db
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
  const siblingItems = (await db.select().from(orderItems).all()).filter((i) =>
    historyOrderIds.has(i.orderId),
  );
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

export interface CatalogProduct {
  id: number;
  name: string;
  priceYen: number | null;
  imageUrl: string | null;
}

/**
 * Picker source: every live catalog product, newest (highest id) first —
 * freebies are usually current products.
 */
export async function getCatalogProducts(
  q?: string,
  limit = 1500,
): Promise<CatalogProduct[]> {
  const term = q?.trim();
  return (await db
    .select({
      id: products.id,
      name: products.name,
      priceYen: products.priceYen,
      imageUrls: products.imageUrls,
    })
    .from(products)
    .where(
      and(
        eq(products.fetchStatus, "ok"),
        sql`${products.name} is not null`,
        term ? like(products.name, `%${term}%`) : undefined,
      ),
    )
    .orderBy(desc(products.id))
    .limit(limit)
    .all()).map((r) => ({
    id: r.id,
    name: r.name ?? "",
    priceYen: r.priceYen,
    imageUrl: firstImage(r.imageUrls),
  }));
}

export interface CatalogProductDetail extends CatalogProduct {
  category: string | null;
  tags: string[];
  imageUrls: string[];
  descriptionHtml: string | null;
}

/** Full catalog row for the picker's preview panel (fetched on demand). */
export async function getCatalogProduct(
  id: number,
): Promise<CatalogProductDetail | null> {
  const p = await db.select().from(products).where(eq(products.id, id)).get();
  if (!p || !p.name) return null;
  const imageUrls = parseJsonArray(p.imageUrls);
  return {
    id: p.id,
    name: p.name,
    priceYen: p.priceYen,
    imageUrl: imageUrls[0] ?? null,
    category: p.category,
    tags: parseJsonArray(p.tags),
    imageUrls,
    descriptionHtml: p.descriptionHtml,
  };
}

export async function getStats() {
  const row = await db
    .select({
      orderCount: sql<number>`count(distinct ${orders.id})`,
      itemCount: sql<number>`count(${orderItems.id})`,
      totalSpentYen: sql<number>`coalesce(sum(${orders.totalYen}), 0)`,
    })
    .from(orders)
    .get();

  const spent = await db
    .select({ total: sql<number>`coalesce(sum(${orders.totalYen}), 0)` })
    .from(orders)
    .get();

  const items = await db
    .select({ count: sql<number>`count(*)` })
    .from(orderItems)
    .get();

  return {
    orderCount: row?.orderCount ?? 0,
    itemCount: items?.count ?? 0,
    totalSpentYen: spent?.total ?? 0,
  };
}

export async function getLastSync() {
  return (
    (await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.status, "success"), eq(syncRuns.kind, "orders")))
      .orderBy(desc(syncRuns.id))
      .get()) ?? null
  );
}

/** Latest catalog sweep (any terminal status) + current catalog size. */
export async function getCatalogState() {
  const lastRun =
    (await db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.kind, "catalog"), eq(syncRuns.status, "success")))
      .orderBy(desc(syncRuns.id))
      .get()) ?? null;
  const count =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(products)
        .where(sql`${products.fetchStatus} = 'ok' and ${products.name} is not null`)
        .get()
    )?.n ?? 0;
  return { count, lastSweptAt: lastRun?.finishedAt ?? null };
}
