import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Conventions
 * - money  : integer yen (never float — all site prices are whole yen)
 * - dates  : ISO-8601 TEXT with an explicit +09:00 offset (site renders JST)
 * - status : the raw Japanese label from the site (no premature enum)
 * - PII    : intentionally absent. Order-detail pages expose the account
 *            holder's address/phone; those columns do not exist here by design.
 */

export const orders = sqliteTable(
  "orders",
  {
    /** 注文番号 — the site's own order id, e.g. "9915" */
    id: text("id").primaryKey(),
    /** 注文日時, e.g. "2026-08-22T08:50:31+09:00" */
    orderedAt: text("ordered_at").notNull(),
    /** 注文状況, e.g. "注文受付" */
    status: text("status").notNull(),

    // Detail-page-only fields (null until the detail page has been fetched).
    subtotalYen: integer("subtotal_yen"),
    feeYen: integer("fee_yen"),
    shippingFeeYen: integer("shipping_fee_yen"),
    totalYen: integer("total_yen"),
    /** 配送方法 label only, e.g. "佐川、日本郵便　送料無料" */
    shippingMethod: text("shipping_method"),

    /** null = detail not yet scraped; drives the incremental sync */
    detailFetchedAt: text("detail_fetched_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("orders_ordered_at_idx").on(t.orderedAt)],
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** null when the site did not link a product (deleted product) */
    productId: integer("product_id").references(() => products.id),
    /** SNAPSHOT — always renderable even if the product page is gone */
    productName: text("product_name").notNull(),
    /** SNAPSHOT — absolute image URL */
    imageUrl: text("image_url"),
    unitPriceYen: integer("unit_price_yen").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [
    index("order_items_order_id_idx").on(t.orderId),
    index("order_items_product_id_idx").on(t.productId),
  ],
);

/** pending = stub created from an order, awaiting fetch */
export type ProductFetchStatus = "pending" | "ok" | "not_found" | "error";

export const products = sqliteTable("products", {
  /** EC-CUBE product id from /products/detail/{id} */
  id: integer("id").primaryKey(),
  name: text("name"),
  priceYen: integer("price_yen"),
  descriptionHtml: text("description_html"),
  category: text("category"),
  /** JSON array of strings */
  tags: text("tags"),
  /** JSON array of absolute image URLs */
  imageUrls: text("image_urls"),
  fetchStatus: text("fetch_status")
    .$type<ProductFetchStatus>()
    .notNull()
    .default("pending"),
  fetchedAt: text("fetched_at"),
  updatedAt: text("updated_at"),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
  status: text("status")
    .$type<"running" | "success" | "error">()
    .notNull()
    .default("running"),
  totalOrders: integer("total_orders"),
  ordersProcessed: integer("orders_processed").notNull().default(0),
  errorMessage: text("error_message"),
});

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Product = typeof products.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
