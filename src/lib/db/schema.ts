import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type { RemindError } from "@/lib/mail-config";
import type { DogSex } from "@/lib/profile";

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
 *            that looks like one. NOTE: when GEMINI_API_KEY or
 *            ANTHROPIC_API_KEY is set, the certificate *image* is sent out to
 *            be read. The user can black out regions before it is sent, and
 *            the stored photo keeps the unmasked original. See DEPLOY.md.
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

/**
 * 「いつものご飯」の登録。朝・夜それぞれに登録しておくと、毎朝8時の cron が
 * その日の meal_entries として同じ形の行を入れる（「いつもの」印は付けない
 * ので、入ったあとは手で書いた記録と1行も違わない）。
 *
 * 列は meal_entries の食べ物側とまったく同じで、**date が無いだけ**。
 *
 * **JSON 1列にしない** — 検証・並び（seq）・商品名の解決が meal_entries と
 * 同じ形なので、行にすれば resolveMealEntry をそのまま再利用できる。
 * JSON にすると同じことをする第2の検証系がここにできる。
 *
 * **meal_entries に架空の date を入れて区別する形にもしない** — min(date) で
 * 「いつから食べているか」を答える食歴・月グリッド・最近のごはんの全読み取りを
 * 汚し、除外条件を1箇所書き忘れた日に黙って壊れる。別テーブルなら
 * 「書き忘れ」が起こらない。
 *
 * slot は USUAL_SLOTS（morning / evening）で守る。CHECK は書かない —
 * drizzle-kit push はこのリポジトリで実際に索引を落としたことがあり
 * （heartworm_doses のコメント参照）、CHECK も同様に落ちうるので依存しない。
 *
 * **後から足す列は必ず nullable か既定値付き** — scripts/push-log-tables.ts の
 * syncColumns は既定値の無い NOT NULL 列を ALTER で足せない（SQLite の制約）。
 * おやつを足すのも列ではなく slot の値でやる（dog_profile と同じ作法）。
 */
export const usualMeals = sqliteTable(
  "usual_meals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "morning" | "evening"。おやつは入らない（朝と夜だけ） */
    slot: text("slot").$type<MealSlot>().notNull(),
    /** スロット内の並び。保存ごとに添字で振り直す（meal_entries と同じ） */
    seq: integer("seq").notNull().default(0),
    /** null = カタログ外（手作り・他社製品） */
    productId: integer("product_id").references(() => products.id),
    /**
     * 登録した時の名前の写し。表示・記録には products.name を優先する
     * （改名はスクレイパが行うのでフックできる書き込みが無く、解決は
     * 読み取り時にやる）。カタログから消えても何を登録したかは読める。
     */
    label: text("label").notNull(),
    /** 分量の自由入力 "50g" / "1袋"（meal_entries と同じ） */
    amount: text("amount"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // 索引は1本だけ（高々20行で、常に全件を slot, seq 順に読むため）。
  // 名前を付けるのは scripts/push-log-tables.ts が sqlite_master の
  // CREATE 文を再生する仕組みで、無名だと本番に届かないから。
  (t) => [index("usual_meals_slot_idx").on(t.slot, t.seq)],
);

export type UsualMeal = typeof usualMeals.$inferSelect;

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

// ------------------------------------------------------------------ ケア記録

/**
 * トリミングと通院を1つのテーブルにまとめる。
 *
 * 形が完全に同じ（日付・行き先・明細・メモ）で、しかも「今年ケアに
 * いくら使ったか」を種類をまたいで数えたい。meal_entries が朝/夜/おやつを
 * slot で1テーブルにまとめているのと同じ判断。
 *
 * 種類の値（CareKind）は src/lib/calendar.ts にある。クライアントが
 * ラベルを import するときに drizzle を引き込まないため。
 *
 * **トリミングは「行った日」ではなく「予約した日」を入れる。** 予約は先に
 * 決まり、金額はあとで確定するので、date は未来でもよい。done/planned の
 * 列は持たない — 予約した日が来れば行ったものとみなし、**今日より先の date
 * を「予定」として描く**（src/lib/calendar-marks.ts / home.ts）。「行ったか」
 * を別の列に持つと、その日が来るたびに印を付け直す仕事が飼い主に増える。
 *
 * **合計金額の列は持たない。** 明細も合計も同じ人が同じダイアログで入れる
 * ので、列にすると真実が2つできて黙って食い違う。合計は常に
 * sum(care_visit_items.amount_yen)。割引は負の金額の明細行で表す。
 * （orders が合計を持つのは、ショップ側で確定した観測値で明細から
 *   復元できないため。前提が違う）
 */
export const careVisits = sqliteTable(
  "care_visits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "trimming" | "hospital" */
    kind: text("kind").notNull(),
    /** トリミングは予約した日、通院は行った日, DATE ONLY */
    date: text("date").notNull(),
    /**
     * 予約の時間 "HH:MM"（24時間・任意）。date と同じく **+09:00 を持たない
     * 裸の文字列**で、暦日と組み合わせて瞬間にはしない（変換を一度も通さない
     * ことで1日ずれる事故を構造的に防ぐ、date と同じ理由）。
     */
    time: text("time"),
    /**
     * 登録したお店・病院（care_places）。名前の写し（place）を別に持つのは、
     * 登録を消したあとも「どこへ行ったか」が読めるようにするため
     * （heartworm_doses の medicine_id / label と同じ作法）。
     *
     * **DB側の外部キーは当てにしない。** この列は既存テーブルへの
     * ALTER TABLE ADD COLUMN で足されるが、SQLite のこの経路では
     * REFERENCES 句が落ちる。そのため deleteCarePlace() が明示的に
     * この列を null に戻す。
     */
    placeId: integer("place_id"),
    /**
     * 店名・病院名（任意）。施設名であって個人名は入れない。
     * place_id があるときは登録側の名前を写す（名前を直せば saveCarePlace が
     * ここも直す）。無いときは自由入力そのもの。
     */
    place: text("place"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("care_visits_kind_date_idx").on(t.kind, t.date),
    index("care_visits_date_idx").on(t.date),
  ],
);

/**
 * 明細の1行。orders / order_items と同じ親子命名。親が消えたら一緒に消す。
 *
 * 金額は **nullable**。トリミングは予約の時点で記録するので、コースは
 * 決まっていても金額がまだ確定していないことが普通にある（当日の追加料金・
 * 割引）。null は「金額が分からない」で、0 は「0円」— 混ぜない。
 * sum() が null を黙って落として過少申告する問題は、集計側が
 * 「金額未確定の件数」を必ず一緒に返すことで見えるようにしている
 * （src/lib/care.ts の summarizeAmounts / getCareYearTotals の pending）。
 * 数量は名前に書く（"内服薬 7日分"）。
 *
 * コース（care_courses）への参照は**持たない**。明細は「その時いくら払ったか」
 * の写しで、コースの値上げや改名に追随してはいけないから
 * （order_items が product_name / unit_price_yen を写しで持つのと同じ）。
 */
export const careVisitItems = sqliteTable(
  "care_visit_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    visitId: integer("visit_id")
      .notNull()
      .references(() => careVisits.id, { onDelete: "cascade" }),
    /** 明細内の表示順 */
    seq: integer("seq").notNull().default(0),
    /** 例 "シャンプーコース" "混合ワクチン" "内服薬 7日分" "割引" */
    name: text("name").notNull(),
    /** 税込・円。割引は負の値。null = まだ確定していない */
    amountYen: integer("amount_yen"),
  },
  (t) => [index("care_visit_items_visit_id_idx").on(t.visitId)],
);

/**
 * いつも行くお店・病院の登録。トリミング／通院の記録で行き先を選ぶ候補。
 *
 * kind で「トリミングのお店」と「通院の病院」を分ける（care_visits と同じ
 * 値）。記録のダイアログは自分の kind の候補だけを出す。
 *
 * 名前は kind の中で一意。同じ店を2回登録しても増えないようにするためで、
 * 名前を直せば、その店を選んである過去の記録の表示も一緒に直る
 * （記録側は place_id で参照しつつ place にも写しを持つ。medicines と同じ）。
 *
 * PII: 住所・電話・URL の列は作らない（dog_profile と同じ方針 — この DB は
 * Turso に出る）。持つのは施設名だけ。
 */
export const carePlaces = sqliteTable(
  "care_places",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "trimming" | "hospital" */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // 名前付きのユニークインデックスにする理由は heartworm_doses のコメント参照
  (t) => [uniqueIndex("care_places_kind_name_idx").on(t.kind, t.name)],
);

/**
 * トリミングのコースの登録（名前と金額）。記録の明細に1タップで入れる型紙。
 *
 * kind を持つのは care_places と揃えるため（通院の「診察料」のような定番
 * 項目を将来ここに入れられる形）。今の画面が出すのは trimming だけ。
 *
 * 金額は nullable。コースはあっても値段が変わる・分からない場合があり、
 * 明細側が空欄を許す（care_visit_items.amount_yen）のと同じ扱いにする。
 *
 * 明細はこのテーブルを**参照しない**（名前と金額を写すだけ）。値上げしても
 * 過去の記録の金額が変わらないため。コースを消しても記録は変わらない。
 */
export const careCourses = sqliteTable(
  "care_courses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "trimming" | "hospital" */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** 税込・円。null = 金額未設定 */
    priceYen: integer("price_yen"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("care_courses_kind_name_idx").on(t.kind, t.name)],
);

/**
 * 薬の登録。ケアの「薬」タブで管理する。
 *
 * 20&20 のカタログとは別物。フィラリア薬は病院で処方されるもので
 * カタログに存在しないため、products とは紐づけない。
 *
 * for_heartworm はただの分類。フィラリアの選択肢をこれで絞るので、
 * 内服薬や外用薬をまとめて登録しても候補が散らからない。
 *
 * 名前は一意。同じ薬を2回登録しても増えないようにするためで、
 * 名前を直せば、その薬を選んである過去の記録の表示も一緒に直る
 * （記録側は medicine_id で参照しつつ label にも写しを持つ）。
 */
export const medicines = sqliteTable(
  "medicines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** フィラリア予防薬か。フィラリアの選択肢はこれで絞る */
    forHeartworm: integer("for_heartworm", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("medicines_name_idx").on(t.name),
    index("medicines_for_heartworm_idx").on(t.forHeartworm),
  ],
);

/**
 * フィラリア予防薬。**予定と実績を1行にまとめる。**
 *
 * 予定を先に作り、飲ませたら given_date を埋める。分けると
 * 「予定はあるが未実施」を出すのに毎回 join が要るうえ、
 * リマインドの判定（未実施かつ未送信）が1行で完結しなくなる。
 *
 * - reminded_at : **送る前に**埋めて予約する。cron が二重に走っても
 *   同じメールを2通送らないため。
 *   ただし送信が失敗したら **戻す**（remind_error に理由を残す）。
 *   戻さないと「送ったことになっているのに届いていない」日が黙って生まれる。
 * - scheduled_date は一意（heartworm_doses_scheduled_date_idx）。
 *   1匹前提のスキーマなので同じ日に2件は作らない。一括生成をやり直しても
 *   重複しない（onConflictDoNothing が効く）。
 * - 商品との紐づけは持たない。フィラリア薬は要処方で 20&20 のカタログに
 *   存在し得ず、全行 null になる列を保守することになるため。
 */
export const heartwormDoses = sqliteTable(
  "heartworm_doses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 飲ませる予定の日, DATE ONLY */
    scheduledDate: text("scheduled_date").notNull(),
    /** 実際に飲ませた日, DATE ONLY。null なら未実施 */
    givenDate: text("given_date"),
    /**
     * 登録した薬。名前の写し（label）を別に持つのは、薬を消したあとも
     * 何を飲ませたかが読めるようにするため（order_items が product_id と
     * product_name を両方持つのと同じ作法）。
     *
     * **DB側の外部キーは当てにしない。** この列は既存テーブルへの
     * ALTER TABLE ADD COLUMN で足されるが、SQLite のこの経路では
     * REFERENCES 句が落ちる（ローカルも本番も実際に付いていない）。
     * そのため deleteMedicine() が明示的にこの列を null に戻す。
     */
    medicineId: integer("medicine_id"),
    /** 薬の名前（スナップショット）。例 "モキシデック チュアブル" */
    label: text("label"),
    note: text("note"),
    /** リマインドを送った時刻（+09:00 付き ISO）。null なら未送信 */
    remindedAt: text("reminded_at"),
    /** 直近の送信失敗の理由。成功したら null に戻す */
    remindError: text("remind_error").$type<RemindError>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    // 列の .unique() ではなく名前付きのユニークインデックスにする。
    // drizzle-kit push は CREATE TABLE の UNIQUE もインデックスも作り落とす
    // ことがあり（実際に落ちた）、scripts/push-log-tables.ts は
    // sqlite_master の CREATE 文を replay するので、名前が付いていれば拾える。
    uniqueIndex("heartworm_doses_scheduled_date_idx").on(t.scheduledDate),
    index("heartworm_doses_given_date_idx").on(t.givenDate),
  ],
);

export type Medicine = typeof medicines.$inferSelect;
export type CareVisit = typeof careVisits.$inferSelect;
export type CareVisitItem = typeof careVisitItems.$inferSelect;
export type CarePlace = typeof carePlaces.$inferSelect;
export type CareCourse = typeof careCourses.$inferSelect;
export type HeartwormDose = typeof heartwormDoses.$inferSelect;

export type MealEntry = typeof mealEntries.$inferSelect;
export type Vaccination = typeof vaccinations.$inferSelect;
export type VaccinationPhoto = typeof vaccinationPhotos.$inferSelect;

// ------------------------------------------------------------ プロフィール

/**
 * もかのプロフィール。**常に id = 1 の1行だけ**（PROFILE_ROW_ID）。
 *
 * 単一行の保証の本体はアプリ側 — PROFILE_ROW_ID 固定 +
 * onConflictDoUpdate({ target: dogProfile.id }) の1経路しか書き込みが無い。
 * CHECK は保険。drizzle-kit push はこのリポジトリで実際にインデックスを
 * 作り落としたことがあり（heartworm_doses のコメント参照）、CHECK も
 * 落ちうるので、CHECK に依存した書き方はしない。
 *
 * id / name / created_at / updated_at 以外はすべて nullable。
 * scripts/push-log-tables.ts の syncColumns は既定値の無い NOT NULL 列を
 * ALTER で足せない（SQLite の制約）ので、将来列が増えても本番に届く形に
 * しておく。
 *
 * PII: intentionally absent — 飼い主の氏名・住所・電話、かかりつけ病院の
 * 連絡先、マイクロチップ番号、鑑札・登録番号の列は作らない。この DB は
 * Turso に出る（schema.ts 冒頭の PII 方針をこのテーブルにも適用）。
 */
export const dogProfile = sqliteTable(
  "dog_profile",
  {
    /** 常に 1。upsert の衝突先（rowid 別名なので索引不要） */
    id: integer("id").primaryKey(),
    /** ヒーローの主役。既定値は置かない */
    name: text("name").notNull(),
    /** 犬種。自由入力（マスタを持たない） */
    breed: text("breed"),
    /** "female" | "male" | null */
    sex: text("sex").$type<DogSex>(),
    /** 誕生日, DATE ONLY 'YYYY-MM-DD' */
    birthday: text("birthday"),
    /** おうちに来た日, DATE ONLY */
    cameHomeOn: text("came_home_on"),
    /** 整数グラム（5.2kg = 5200） */
    weightGrams: integer("weight_grams"),
    /** その体重を測った日, DATE ONLY */
    weighedOn: text("weighed_on"),
    /** ひとこと（40文字） */
    note: text("note"),
    /** Blob の削除キー＝表示経路の鍵 */
    photoPathname: text("photo_pathname"),
    /** /api/dog-photo が返す Content-Type */
    photoContentType: text("photo_content_type"),
    /** 添付時の検証値の控え（診断用） */
    photoSizeBytes: integer("photo_size_bytes"),
    /** +09:00 付き ISO。?v= のキャッシュ破り */
    photoUpdatedAt: text("photo_updated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  // インデックスなし（単一行・PK 引きのみ）
  (t) => [check("dog_profile_single_row", sql`${t.id} = 1`)],
);

export type DogProfile = typeof dogProfile.$inferSelect;
