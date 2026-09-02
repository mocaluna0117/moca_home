import "server-only";

import { and, asc, desc, eq, gte, inArray, like, lt, sql } from "drizzle-orm";

import {
  MEAL_SLOTS,
  monthRange,
  type DateStr,
  type MealSlot,
  type YearMonth,
} from "@/lib/calendar";
import { db } from "@/lib/db";
import {
  mealEntries,
  products,
  usualMeals,
  vaccinationPhotos,
  vaccinations,
  type MealEntry,
  type Vaccination,
  type VaccinationPhoto,
} from "@/lib/db/schema";
import { parseJsonArray } from "@/lib/format";
import { isUsualSlot, type UsualSlot } from "@/lib/usual-meals";

function firstImage(raw: string | null): string | null {
  const arr = parseJsonArray(raw);
  return arr[0] ?? null;
}

// ------------------------------------------------------------------ 食事記録

export interface MealEntryRow extends MealEntry {
  /** product_id があるときだけ products.image_urls の先頭 */
  imageUrl: string | null;
}

export interface DayMeals {
  date: DateStr;
  morning: MealEntryRow[];
  evening: MealEntryRow[];
  treat: MealEntryRow[];
  /** 3スロット合計の行数 */
  total: number;
}

function emptyDay(date: DateStr): DayMeals {
  return { date, morning: [], evening: [], treat: [], total: 0 };
}

function groupByDate(
  rows: { row: MealEntry; productImages: string | null }[],
): Map<DateStr, DayMeals> {
  const map = new Map<DateStr, DayMeals>();
  for (const r of rows) {
    const entry: MealEntryRow = { ...r.row, imageUrl: firstImage(r.productImages) };
    const day = map.get(entry.date) ?? emptyDay(entry.date);
    day[entry.slot].push(entry);
    day.total += 1;
    map.set(entry.date, day);
  }
  return map;
}

/**
 * 1か月ぶんをクエリ1回で。記録のある日だけを返す（42マスの生成はレンダラの
 * 仕事）。既存の getOrders と同じ「一括クエリ + メモリで grouping」の形。
 */
export async function getMealMonth(ym: YearMonth): Promise<DayMeals[]> {
  const range = monthRange(ym);
  if (!range) return [];

  const rows = await db
    .select({ row: mealEntries, productImages: products.imageUrls })
    .from(mealEntries)
    .leftJoin(products, eq(products.id, mealEntries.productId))
    .where(
      and(gte(mealEntries.date, range.start), lt(mealEntries.date, range.endExclusive)),
    )
    .orderBy(asc(mealEntries.date), asc(mealEntries.seq), asc(mealEntries.id))
    .all();

  return [...groupByDate(rows).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 1日ぶん。ダイアログの初期値に使う（記録が無くても空の形を返す）。 */
export async function getMealDay(date: DateStr): Promise<DayMeals> {
  const rows = await db
    .select({ row: mealEntries, productImages: products.imageUrls })
    .from(mealEntries)
    .leftJoin(products, eq(products.id, mealEntries.productId))
    .where(eq(mealEntries.date, date))
    .orderBy(asc(mealEntries.seq), asc(mealEntries.id))
    .all();
  return groupByDate(rows).get(date) ?? emptyDay(date);
}

/** 「前回と同じ」用。指定日より前で、そのスロットに記録がある直近の日。 */
export async function getPreviousSlot(
  date: DateStr,
  slot: MealSlot,
): Promise<{ date: DateStr; entries: MealEntryRow[] } | null> {
  const prev = await db
    .select({ date: mealEntries.date })
    .from(mealEntries)
    .where(and(lt(mealEntries.date, date), eq(mealEntries.slot, slot)))
    .orderBy(desc(mealEntries.date))
    .limit(1)
    .get();
  if (!prev) return null;

  const rows = await db
    .select({ row: mealEntries, productImages: products.imageUrls })
    .from(mealEntries)
    .leftJoin(products, eq(products.id, mealEntries.productId))
    .where(and(eq(mealEntries.date, prev.date), eq(mealEntries.slot, slot)))
    .orderBy(asc(mealEntries.seq), asc(mealEntries.id))
    .all();

  return {
    date: prev.date,
    entries: rows.map((r) => ({ ...r.row, imageUrl: firstImage(r.productImages) })),
  };
}

/**
 * 直近で記録のある日を新しい順に limit 日ぶん。
 *
 * getMealMonth では答えられない（月初に開くと1〜2件しか出ない）。
 * ホームはこの1本で「今日のごはん」「最近のごはん3日」「前回をコピーの
 * 供給元」の3つを賄う — 同じ「前回」の真実を2箇所から引かない。
 *
 * getPreviousSlot は**使わない**: あれはスロット単位のクエリで、
 * copyMealDay（actions-log.ts）は日単位に丸ごと入れ替える操作なので、
 * 夜だけ記録した日が「前回」から漏れる。
 *
 * limit の既定が 4 なのは、今日に記録があると [今日, -1, -2, -3] で
 * 「今日 + 前3日」がちょうど揃い、今日に記録が無ければ前4日から
 * 先頭3日を使えるため。
 */
export async function getRecentMealDays(limit = 4): Promise<DayMeals[]> {
  const days = await db
    .selectDistinct({ date: mealEntries.date })
    .from(mealEntries)
    .orderBy(desc(mealEntries.date))
    .limit(limit)
    .all();
  if (days.length === 0) return [];

  const rows = await db
    .select({ row: mealEntries, productImages: products.imageUrls })
    .from(mealEntries)
    .leftJoin(products, eq(products.id, mealEntries.productId))
    .where(
      inArray(
        mealEntries.date,
        days.map((d) => d.date),
      ),
    )
    .orderBy(desc(mealEntries.date), asc(mealEntries.seq), asc(mealEntries.id))
    .all();

  // 新しい順。日ごとの組み立ては既存の groupByDate をそのまま再利用する
  return [...groupByDate(rows).values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ------------------------------------------------------------------ いつものご飯

export interface UsualMealRow {
  id: number;
  slot: UsualSlot;
  seq: number;
  productId: number | null;
  /** 表示・記録に使う名前。カタログにあれば今の products.name、無ければ登録時の写し */
  label: string;
  amount: string | null;
  note: string | null;
  imageUrl: string | null;
}

/**
 * 「いつものご飯」の登録を全件。高々20行なので1文で読み切る。
 *
 * **名前は読み取り時に解決する**（getHeartwormDoses と同じ）。カタログに
 * あれば今の products.name、無ければ登録時の写し。saveMedicine のように
 * 書き込み時に写しを直す方式にしないのは、カタログの改名はスクレイパが
 * 行い、フックできるアクションが無いため。
 *
 * `?.trim() ||` の `||` は**必ず要る**。products.name は nullable
 * （fetch_status='pending' のスタブ）で、空文字をそのまま返すと
 * applyUsualMeals が NOT NULL の meal_entries.label に空文字を入れようとして
 * その日の記録を落とす。
 *
 * ORDER BY の slot は文字列順なので夜（evening）が先に来る。**朝 → 夜の
 * 並びは USUAL_SLOTS が決める**（groupUsualBySlot / planUsualApply）ので、
 * ここが保証するのは「スロットごとに seq 順で固まっている」ことだけ。
 */
export async function getUsualMeals(): Promise<UsualMealRow[]> {
  const rows = await db
    .select({
      id: usualMeals.id,
      slot: usualMeals.slot,
      seq: usualMeals.seq,
      productId: usualMeals.productId,
      label: usualMeals.label,
      amount: usualMeals.amount,
      note: usualMeals.note,
      productName: products.name,
      productImages: products.imageUrls,
    })
    .from(usualMeals)
    .leftJoin(products, eq(products.id, usualMeals.productId))
    .orderBy(asc(usualMeals.slot), asc(usualMeals.seq), asc(usualMeals.id))
    .all();

  const out: UsualMealRow[] = [];
  for (const r of rows) {
    // 列の型は MealSlot 汎用（おやつを後から足せる形にしてある）。この機能が
    // 適用するのは朝と夜だけなので、範囲外は読み取りの時点で落とす
    if (!isUsualSlot(r.slot)) continue;
    out.push({
      id: r.id,
      slot: r.slot,
      seq: r.seq,
      productId: r.productId,
      label: r.productName?.trim() || r.label,
      amount: r.amount,
      note: r.note,
      imageUrl: firstImage(r.productImages),
    });
  }
  return out;
}

// ------------------------------------------------------------------ 食歴

export interface FoodHistory {
  productId: number | null;
  /** "p:1234" | "n:手作りごはん" — getProductSummaries と同じキー規約 */
  key: string;
  label: string;
  imageUrl: string | null;
  /** 初めて食べた日 — これが「いつから」の答え */
  firstDate: DateStr;
  lastDate: DateStr;
  /** 食べた日数（distinct date）。朝夜2回でも1日 */
  dayCount: number;
  /** 記録行の総数 */
  entryCount: number;
  slots: Record<MealSlot, number>;
}

const KEY_EXPR = sql<string>`coalesce('p:' || ${mealEntries.productId}, 'n:' || ${mealEntries.label})`;

/** 集約はすべて SQL 側。`q` は label 部分一致。 */
export async function getFoodHistory(q?: string): Promise<FoodHistory[]> {
  const term = q?.trim();
  const rows = await db
    .select({
      key: KEY_EXPR,
      productId: mealEntries.productId,
      label: sql<string>`max(${mealEntries.label})`,
      firstDate: sql<string>`min(${mealEntries.date})`,
      lastDate: sql<string>`max(${mealEntries.date})`,
      dayCount: sql<number>`count(distinct ${mealEntries.date})`,
      entryCount: sql<number>`count(*)`,
      morning: sql<number>`sum(case when ${mealEntries.slot} = 'morning' then 1 else 0 end)`,
      evening: sql<number>`sum(case when ${mealEntries.slot} = 'evening' then 1 else 0 end)`,
      treat: sql<number>`sum(case when ${mealEntries.slot} = 'treat' then 1 else 0 end)`,
      productImages: sql<string | null>`max(${products.imageUrls})`,
    })
    .from(mealEntries)
    .leftJoin(products, eq(products.id, mealEntries.productId))
    .where(term ? like(mealEntries.label, `%${term}%`) : undefined)
    .groupBy(KEY_EXPR)
    .orderBy(desc(sql`max(${mealEntries.date})`))
    .all();

  return rows.map((r) => ({
    productId: r.productId,
    key: r.key,
    label: r.label,
    imageUrl: firstImage(r.productImages),
    firstDate: r.firstDate,
    lastDate: r.lastDate,
    dayCount: Number(r.dayCount),
    entryCount: Number(r.entryCount),
    slots: {
      morning: Number(r.morning),
      evening: Number(r.evening),
      treat: Number(r.treat),
    },
  }));
}

export interface ProductMealSummary {
  firstDate: DateStr | null;
  lastDate: DateStr | null;
  lastSlot: MealSlot | null;
  dayCount: number;
  entryCount: number;
  slots: Record<MealSlot, number>;
  /** 直近の記録（最大8件） */
  recent: { id: number; date: DateStr; slot: MealSlot }[];
}

/** /products/[id] 用。「いつから食べているか」を答える。 */
export async function getProductMealSummary(
  productId: number,
): Promise<ProductMealSummary> {
  const rows = await db
    .select({
      id: mealEntries.id,
      date: mealEntries.date,
      slot: mealEntries.slot,
    })
    .from(mealEntries)
    .where(eq(mealEntries.productId, productId))
    .orderBy(desc(mealEntries.date), desc(mealEntries.id))
    .all();

  const slots: Record<MealSlot, number> = { morning: 0, evening: 0, treat: 0 };
  for (const r of rows) slots[r.slot] += 1;
  const dates = new Set(rows.map((r) => r.date));

  return {
    firstDate: rows.length ? rows[rows.length - 1].date : null,
    lastDate: rows.length ? rows[0].date : null,
    lastSlot: rows.length ? rows[0].slot : null,
    dayCount: dates.size,
    entryCount: rows.length,
    slots,
    recent: rows.slice(0, 8),
  };
}

/** その月に「初めて食べた」ものだけ。カレンダー上部に出す。 */
export async function getStartedInMonth(ym: YearMonth): Promise<FoodHistory[]> {
  const range = monthRange(ym);
  if (!range) return [];
  const all = await getFoodHistory();
  return all
    .filter((f) => f.firstDate >= range.start && f.firstDate < range.endExclusive)
    .sort((a, b) => (a.firstDate < b.firstDate ? -1 : 1));
}

/** ピッカーで先頭に固定する「よく使う商品」。 */
export async function getFrequentFoodProductIds(limit = 12): Promise<number[]> {
  const rows = await db
    .select({
      productId: mealEntries.productId,
      n: sql<number>`count(*)`,
    })
    .from(mealEntries)
    .where(sql`${mealEntries.productId} is not null`)
    .groupBy(mealEntries.productId)
    .orderBy(desc(sql`count(*)`))
    .limit(limit)
    .all();
  return rows.map((r) => r.productId).filter((id): id is number => id !== null);
}

// ------------------------------------------------------------------ ワクチン

export interface VaccinationRow extends Vaccination {
  photos: VaccinationPhoto[];
}

/** 接種日の新しい順。写真は1回の追加クエリでまとめて引く（N+1にしない）。 */
export async function getVaccinations(): Promise<VaccinationRow[]> {
  const rows = await db
    .select()
    .from(vaccinations)
    .orderBy(desc(vaccinations.date), desc(vaccinations.id))
    .all();
  if (rows.length === 0) return [];

  const photos = await db
    .select()
    .from(vaccinationPhotos)
    .where(
      inArray(
        vaccinationPhotos.vaccinationId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(vaccinationPhotos.id))
    .all();

  const byRecord = new Map<number, VaccinationPhoto[]>();
  for (const p of photos) {
    const list = byRecord.get(p.vaccinationId);
    if (list) list.push(p);
    else byRecord.set(p.vaccinationId, [p]);
  }

  return rows.map((r) => ({ ...r, photos: byRecord.get(r.id) ?? [] }));
}

export interface VaccinationScheduleRow {
  id: number;
  date: DateStr;
  name: string;
  nextDueDate: DateStr | null;
}

/**
 * 次回予定日の判定に必要な3列だけ（+ id）。
 *
 * ホームで getVaccinations() を呼ばないのは、あれが vaccination_photos まで
 * join する2文で、ヒーローの下の1行に写真は要らないため。
 * どれが「生きている予定」かの判定はここではなく純関数側
 * （src/lib/home.ts の liveVaccinationDues）— 判定を2箇所に置かない。
 *
 * 全件引くが高々数十行（現状0行）。接種記録は年に数回しか増えない。
 */
export async function getVaccinationSchedule(): Promise<VaccinationScheduleRow[]> {
  return db
    .select({
      id: vaccinations.id,
      date: vaccinations.date,
      name: vaccinations.name,
      nextDueDate: vaccinations.nextDueDate,
    })
    .from(vaccinations)
    .orderBy(desc(vaccinations.date), desc(vaccinations.id))
    .all();
}

/** カレンダーのマスに注射アイコンを出すため、その月の接種日だけ。 */
export async function getVaccinationDates(
  ym: YearMonth,
): Promise<Map<DateStr, string[]>> {
  const range = monthRange(ym);
  const map = new Map<DateStr, string[]>();
  if (!range) return map;
  const rows = await db
    .select({ date: vaccinations.date, name: vaccinations.name })
    .from(vaccinations)
    .where(
      and(gte(vaccinations.date, range.start), lt(vaccinations.date, range.endExclusive)),
    )
    .all();
  for (const r of rows) {
    const list = map.get(r.date);
    if (list) list.push(r.name);
    else map.set(r.date, [r.name]);
  }
  return map;
}

export async function getVaccinationPhoto(
  id: number,
): Promise<VaccinationPhoto | null> {
  return (
    (await db
      .select()
      .from(vaccinationPhotos)
      .where(eq(vaccinationPhotos.id, id))
      .get()) ?? null
  );
}

export { MEAL_SLOTS };
