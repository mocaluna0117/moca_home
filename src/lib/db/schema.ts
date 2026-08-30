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
 *            The same rule holds for vaccination certificates: only the date,
 *            vaccine name, clinic name and next-due date are stored. Owner
 *            name, address and phone are visible in the photo but never in a
 *            column — src/lib/vaccination-extract.ts drops any extracted value
 *            that looks like one. NOTE: when ANTHROPIC_API_KEY is set, the
 *            certificate *image* (pixels, including that PII) is sent to the
 *            Anthropic API to be read. See DEPLOY.md.
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
  kind: text("kind")
    .$type<"orders" | "catalog">()
    .notNull()
    .default("orders"),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
  /**
   * Bumped on every unit of progress. Staleness of a `running` row is judged
   * from coalesce(heartbeat_at, started_at) — a catalog sweep runs ~30 min,
   * far past the 10-min stale threshold measured from started_at alone.
   */
  heartbeatAt: text("heartbeat_at"),
  status: text("status")
    .$type<"running" | "success" | "error">()
    .notNull()
    .default("running"),
  /** kind=orders: order counts. kind=catalog: repurposed as probe counters. */
  totalOrders: integer("total_orders"),
  ordersProcessed: integer("orders_processed").notNull().default(0),
  errorMessage: text("error_message"),
});

/**
 * Manually recorded freebies that actually arrived with an order — the
 * source of truth the title-derived predictions defer to. No PII.
 */
export const receivedBonuses = sqliteTable(
  "received_bonuses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** null = free-text entry (unannounced extras, non-catalog gifts) */
    productId: integer("product_id").references(() => products.id),
    /** SNAPSHOT of the catalog product name at record time, or the free text */
    label: text("label").notNull(),
    quantity: integer("quantity").notNull().default(1),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("received_bonuses_order_id_idx").on(t.orderId)],
);

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Product = typeof products.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;

export type ReceivedBonus = typeof receivedBonuses.$inferSelect;

// ------------------------------------------------------------- お気に入り
//
// アプリ内のお気に入り。星の ON/OFF は **このアプリだけ** に書き、
// 20and20.pet へは一切書き込まない（POST/DELETE を送らない）。
// 同期はショップの /mypage/favorite を「初期値として取り込む」だけ。
//
// 行は決して削除しない。starred=false は「ユーザーが意図的に外した」墓標で、
// これが無いと次の取り込みが外したはずの星を復活させてしまう。
// 「一度も星をつけていない」= 行が無い、「外した」= starred=false の行がある。
//
// 列の書き手を分ける: 取り込みは starred に触らず、toggleFavorite は
// shopFavorite / source に触らない（src/lib/favorites.ts に規則と検証あり）。

/** local = このアプリで星をつけた / shop = ショップから取り込んだ */
export type FavoriteSource = "local" | "shop";

export const productFavorites = sqliteTable(
  "product_favorites",
  {
    /**
     * 1商品 = 高々1行。代理キーを置かず product_id 自体を PK にする
     * （integer PRIMARY KEY は rowid の別名なので追加インデックス不要）。
     */
    productId: integer("product_id")
      .primaryKey()
      .references(() => products.id, { onDelete: "cascade" }),
    /** 現在の星。false = 明示的に外した墓標（取り込みで復活させない） */
    starred: integer("starred", { mode: "boolean" }).notNull().default(true),
    /** 最後の取り込み時点でショップのお気に入りにも入っていたか */
    shopFavorite: integer("shop_favorite", { mode: "boolean" })
      .notNull()
      .default(false),
    /** この行ができた経緯（以後書き換えない） */
    source: text("source").$type<FavoriteSource>().notNull().default("local"),
    /** 星を最後に切り替えた瞬間（ON/OFF どちらでも更新） */
    starredAt: text("starred_at"),
    /** ショップのお気に入り一覧で最後に見た瞬間 */
    shopSeenAt: text("shop_seen_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("product_favorites_starred_idx").on(t.starred, t.starredAt)],
);

export type ProductFavorite = typeof productFavorites.$inferSelect;

// ---------------------------------------------------------------- 飼育記録
//
// 以下3テーブルの `date` / `next_due_date` は、他のカラムと違い
// **+09:00 を持たない裸の 'YYYY-MM-DD'**。暦日は「瞬間」ではないため、
// タイムゾーン変換を一度も通さないことで日付が1日ずれる事故を構造的に
// 防ぐ（月の抽出も純粋な文字列比較になる）。
// created_at / updated_at は本物の瞬間なので従来どおり nowJstIso()。

/** "morning" | "evening" | "treat" — src/lib/calendar.ts と同じ集合 */
export type MealSlot = "morning" | "evening" | "treat";

/**
 * 食事の日誌。1日は朝・夜の2食で、おやつを第3のスロットとして同じ形で扱う。
 *
 * 1行 = 1スロットで与えた食べ物1つ（order_items が1注文に複数行並ぶのと
 * 同じ構造の日付版）。「この商品をいつから食べているか」を SQL の min(date)
 * で答えるため、食べ物は JSON 配列ではなく必ず行として持つ。
 */
export const mealEntries = sqliteTable(
  "meal_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 与えた日, DATE ONLY e.g. "2026-08-30" */
    date: text("date").notNull(),
    slot: text("slot").$type<MealSlot>().notNull(),
    /** スロット内の表示順（主食 → トッピングの並びを保つ） */
    seq: integer("seq").notNull().default(0),
    /** null = カタログ外（手作り・他社製品・もらい物） */
    productId: integer("product_id").references(() => products.id),
    /**
     * SNAPSHOT — 記録時のカタログ名、または自由入力そのもの。
     * 日誌は消えない記録なので、カタログ同期で商品が改名・削除されても
     * 「何を食べていたか」が読み取れなくなってはいけない。
     */
    label: text("label").notNull(),
    /** 分量の自由入力 "50g" / "1袋" — 単位が一定しないので数値にしない */
    amount: text("amount"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("meal_entries_date_slot_idx").on(t.date, t.slot),
    index("meal_entries_product_id_idx").on(t.productId),
    index("meal_entries_label_idx").on(t.label),
  ],
);

/** ワクチン接種の記録。証明書の写真は vaccination_photos に 1..n */
export const vaccinations = sqliteTable(
  "vaccinations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 接種日, DATE ONLY */
    date: text("date").notNull(),
    /** 例 "6種混合ワクチン" / "狂犬病予防注射" */
    name: text("name").notNull(),
    /** 動物病院名（任意） */
    clinic: text("clinic"),
    /** 次回接種予定日（任意）, DATE ONLY */
    nextDueDate: text("next_due_date"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("vaccinations_date_idx").on(t.date)],
);

/**
 * 接種証明書の写真。実体は Vercel Blob（private ストア）にあり、
 * ここはメタデータだけを持つ。
 * - url      : Blob の URL（private なので直リンクでは開けない）
 * - pathname : del() の削除キー。URL 形式の変更に強くするため独立した列
 * - width/height : 縮小後の実寸。next/image に渡してレイアウトのずれを防ぐ
 */
export const vaccinationPhotos = sqliteTable(
  "vaccination_photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vaccinationId: integer("vaccination_id")
      .notNull()
      .references(() => vaccinations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    pathname: text("pathname").notNull(),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("vaccination_photos_vaccination_id_idx").on(t.vaccinationId)],
);

export type MealEntry = typeof mealEntries.$inferSelect;
export type Vaccination = typeof vaccinations.$inferSelect;
export type VaccinationPhoto = typeof vaccinationPhotos.$inferSelect;
