import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  careCourses,
  carePlaces,
  careVisitItems,
  careVisits,
  heartwormDoses,
  medicines,
} from "@/lib/db/schema";
import { summarizeAmounts, type AmountSummary } from "@/lib/care";
import type { CareKind, DateStr } from "@/lib/calendar";
import type { DoseRow } from "@/lib/heartworm";
import { TRIM_REQUIRED_INTERVALS, type TrimmingReservation } from "@/lib/home";

export interface CareItemRow {
  id: number;
  seq: number;
  name: string;
  /** null = 金額未確定 */
  amountYen: number | null;
}

export interface CareVisitRow {
  id: number;
  kind: CareKind;
  date: DateStr;
  /** "HH:MM"。未設定なら null */
  time: string | null;
  /** 登録したお店。登録から消されたか自由入力なら null */
  placeId: number | null;
  /** 表示に使う名前。登録済みなら今の名前、消された登録なら写しが残る */
  place: string | null;
  note: string | null;
  items: CareItemRow[];
  /** 明細から計算する。DBには合計の列を持たない。未確定の数も一緒に返る */
  amounts: AmountSummary;
}

/**
 * ある種類の来店記録を新しい順に。明細は1回の追加クエリでまとめて引く
 * （getOrders と同じく N+1 を作らない）。
 *
 * 新しい順なので、今日より先の予約が先頭に並ぶ（「次の予約」が一番上）。
 * お店の名前は登録側を優先する（heartworm の薬名と同じ作法）。
 */
export async function getCareVisits(kind: CareKind): Promise<CareVisitRow[]> {
  const rows = await db
    .select({
      id: careVisits.id,
      kind: careVisits.kind,
      date: careVisits.date,
      time: careVisits.time,
      placeId: careVisits.placeId,
      place: careVisits.place,
      note: careVisits.note,
      placeName: carePlaces.name,
    })
    .from(careVisits)
    .leftJoin(carePlaces, eq(carePlaces.id, careVisits.placeId))
    .where(eq(careVisits.kind, kind))
    .orderBy(desc(careVisits.date), desc(careVisits.time), desc(careVisits.id))
    .all();
  if (rows.length === 0) return [];

  const items = await db
    .select()
    .from(careVisitItems)
    .where(
      inArray(
        careVisitItems.visitId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(careVisitItems.seq), asc(careVisitItems.id))
    .all();

  const byVisit = new Map<number, CareItemRow[]>();
  for (const it of items) {
    const row = { id: it.id, seq: it.seq, name: it.name, amountYen: it.amountYen };
    const list = byVisit.get(it.visitId);
    if (list) list.push(row);
    else byVisit.set(it.visitId, [row]);
  }

  return rows.map((r) => {
    const own = byVisit.get(r.id) ?? [];
    return {
      id: r.id,
      kind: r.kind as CareKind,
      date: r.date,
      time: r.time,
      placeId: r.placeName === null ? null : r.placeId,
      place: r.placeName ?? r.place,
      note: r.note,
      items: own,
      amounts: summarizeAmounts(own),
    };
  });
}

export interface CareYearTotal {
  year: string;
  visits: number;
  /** 金額の入っている明細の合計（未確定ぶんは含まない） */
  totalYen: number;
  /** 金額未確定の明細がある、または明細が無い回数。0 でなければ合計は下限 */
  pending: number;
}

/**
 * 年ごとの回数と金額。「今年いくら使ったか」に答えるため。
 *
 * **今日より先の予約は数えない**（まだ使っていない）。sum() は null を
 * 黙って落とすので、未確定の回数を必ず一緒に返す（表示側が「未確定 N回」
 * と添える）。明細が1行も無い回も left join で amount_yen が null の行に
 * なるので、同じ式で「未確定」に入る。
 */
export async function getCareYearTotals(
  kind: CareKind,
  today: DateStr,
): Promise<CareYearTotal[]> {
  const rows = await db
    .select({
      year: sql<string>`substr(${careVisits.date}, 1, 4)`,
      visits: sql<number>`count(distinct ${careVisits.id})`,
      total: sql<number>`coalesce(sum(${careVisitItems.amountYen}), 0)`,
      pending: sql<number>`count(distinct case when ${careVisitItems.amountYen} is null then ${careVisits.id} end)`,
    })
    .from(careVisits)
    .leftJoin(careVisitItems, eq(careVisitItems.visitId, careVisits.id))
    .where(and(eq(careVisits.kind, kind), lte(careVisits.date, today)))
    .groupBy(sql`substr(${careVisits.date}, 1, 4)`)
    .orderBy(desc(sql`substr(${careVisits.date}, 1, 4)`))
    .all();
  return rows.map((r) => ({
    year: r.year,
    visits: r.visits,
    totalYen: r.total,
    pending: r.pending,
  }));
}

/**
 * カレンダーのマスに印を出すため、その月に来店（予約）した日だけ。
 * 予定か記録かは buildCalendarMarks が today と比べて決める。
 *
 * endExclusive は名前どおり**含まない**（monthRange が返す「翌月初」を
 * そのまま渡せる）。lte だと翌月1日の記録が今月のマスに漏れる。
 */
export async function getCareDates(
  startDate: DateStr,
  endExclusive: DateStr,
): Promise<Map<DateStr, CareKind[]>> {
  const rows = await db
    .select({ date: careVisits.date, kind: careVisits.kind })
    .from(careVisits)
    .where(and(gte(careVisits.date, startDate), lt(careVisits.date, endExclusive)))
    .all();
  const map = new Map<DateStr, CareKind[]>();
  for (const r of rows) {
    const list = map.get(r.date);
    const kind = r.kind as CareKind;
    if (list) {
      if (!list.includes(kind)) list.push(kind);
    } else map.set(r.date, [kind]);
  }
  return map;
}

/**
 * 種類ごとの直近の来店日だけ。**明細を join しない。**
 *
 * ホームで getCareVisits を丸ごと引かないための細いクエリ
 * （あれは明細の2文目が付き、金額もホームには出さない）。
 *
 * **`before` より前の日だけ**を返す（予約は含めない）。トリミングの周期を
 * 推定する材料なので、まだ行っていない予約が「前回」に混ざると中央値が
 * でたらめになる。limit の既定は「間隔3本 = 日付4件」（src/lib/home.ts の
 * TRIM_REQUIRED_INTERVALS がその 3 を持つ）。
 */
export async function getRecentCareDates(
  kind: CareKind,
  before: DateStr,
  limit = TRIM_REQUIRED_INTERVALS + 1,
): Promise<DateStr[]> {
  const rows = await db
    .select({ date: careVisits.date })
    .from(careVisits)
    .where(and(eq(careVisits.kind, kind), lt(careVisits.date, before)))
    .orderBy(desc(careVisits.date), desc(careVisits.id))
    .limit(limit)
    .all();
  return rows.map((r) => r.date);
}

/**
 * 今日以降の予約（日付・時間・お店だけ）。ホームの「次の予定」が使う。
 * 近い順。お店の名前は登録側を優先する。
 */
export async function getUpcomingCareVisits(
  kind: CareKind,
  today: DateStr,
): Promise<TrimmingReservation[]> {
  const rows = await db
    .select({
      date: careVisits.date,
      time: careVisits.time,
      place: careVisits.place,
      placeName: carePlaces.name,
    })
    .from(careVisits)
    .leftJoin(carePlaces, eq(carePlaces.id, careVisits.placeId))
    .where(and(eq(careVisits.kind, kind), gte(careVisits.date, today)))
    .orderBy(asc(careVisits.date), asc(careVisits.time), asc(careVisits.id))
    .all();
  return rows.map((r) => ({ date: r.date, time: r.time, place: r.placeName ?? r.place }));
}

export interface CarePlaceRow {
  id: number;
  kind: CareKind;
  name: string;
  /** このお店を選んである記録の数。削除の影響が見えるように数える */
  usedCount: number;
}

/** 登録済みのお店・病院。種類で絞り、名前順。 */
export async function getCarePlaces(kind: CareKind): Promise<CarePlaceRow[]> {
  const rows = await db
    .select({
      id: carePlaces.id,
      kind: carePlaces.kind,
      name: carePlaces.name,
      usedCount: sql<number>`(
        select count(*) from ${careVisits}
        where ${careVisits.placeId} = ${carePlaces.id}
      )`,
    })
    .from(carePlaces)
    .where(eq(carePlaces.kind, kind))
    .orderBy(asc(carePlaces.name))
    .all();
  return rows.map((r) => ({ ...r, kind: r.kind as CareKind }));
}

export interface CareCourseRow {
  id: number;
  kind: CareKind;
  name: string;
  /** null = 金額未設定 */
  priceYen: number | null;
}

/** 登録済みのコース。種類で絞り、名前順。 */
export async function getCareCourses(kind: CareKind): Promise<CareCourseRow[]> {
  const rows = await db
    .select({
      id: careCourses.id,
      kind: careCourses.kind,
      name: careCourses.name,
      priceYen: careCourses.priceYen,
    })
    .from(careCourses)
    .where(eq(careCourses.kind, kind))
    .orderBy(asc(careCourses.name))
    .all();
  return rows.map((r) => ({ ...r, kind: r.kind as CareKind }));
}

export interface MedicineRow {
  id: number;
  name: string;
  forHeartworm: boolean;
  /** この薬を選んである予定の数。削除の影響が見えるように数える */
  usedCount: number;
}

/** 登録済みの薬。名前順。 */
export async function getMedicines(): Promise<MedicineRow[]> {
  const rows = await db
    .select({
      id: medicines.id,
      name: medicines.name,
      forHeartworm: medicines.forHeartworm,
      usedCount: sql<number>`(
        select count(*) from ${heartwormDoses}
        where ${heartwormDoses.medicineId} = ${medicines.id}
      )`,
    })
    .from(medicines)
    .orderBy(asc(medicines.name))
    .all();
  return rows;
}

/** フィラリアの選択肢。for_heartworm を立てた薬だけ */
export async function getHeartwormMedicines(): Promise<
  { id: number; name: string }[]
> {
  return db
    .select({ id: medicines.id, name: medicines.name })
    .from(medicines)
    .where(eq(medicines.forHeartworm, true))
    .orderBy(asc(medicines.name))
    .all();
}

export interface HeartwormRow extends DoseRow {
  medicineId: number | null;
  /** 表示に使う名前。登録済みの薬なら今の名前、消された薬なら写しが残る */
  label: string | null;
  note: string | null;
  remindError: string | null;
}

/**
 * 予定を日付順に。過去も未来もまとめて返す（件数が高々数十のため）。
 *
 * 薬名は登録側を優先する。薬の名前を直したら過去の記録の表示も直る。
 * 薬を消した場合は medicine_id が null になり、写し（label）が残る。
 */
export async function getHeartwormDoses(): Promise<HeartwormRow[]> {
  const rows = await db
    .select({
      id: heartwormDoses.id,
      scheduledDate: heartwormDoses.scheduledDate,
      givenDate: heartwormDoses.givenDate,
      remindedAt: heartwormDoses.remindedAt,
      medicineId: heartwormDoses.medicineId,
      label: heartwormDoses.label,
      note: heartwormDoses.note,
      remindError: heartwormDoses.remindError,
      medicineName: medicines.name,
    })
    .from(heartwormDoses)
    .leftJoin(medicines, eq(medicines.id, heartwormDoses.medicineId))
    .orderBy(asc(heartwormDoses.scheduledDate))
    .all();
  return rows.map((r) => ({
    id: r.id,
    scheduledDate: r.scheduledDate,
    givenDate: r.givenDate,
    remindedAt: r.remindedAt,
    medicineId: r.medicineId,
    label: r.medicineName ?? r.label,
    note: r.note,
    remindError: r.remindError,
  }));
}

/**
 * リマインドの候補。**絞り込みの正解は src/lib/heartworm.ts の
 * selectDosesToRemind が持つ**ので、ここは粗く引くだけにする
 * （判定を2箇所に書かない）。
 */
export async function getReminderCandidates(floor: DateStr, today: DateStr): Promise<DoseRow[]> {
  const rows = await db
    .select({
      id: heartwormDoses.id,
      scheduledDate: heartwormDoses.scheduledDate,
      givenDate: heartwormDoses.givenDate,
      remindedAt: heartwormDoses.remindedAt,
    })
    .from(heartwormDoses)
    .where(
      and(
        isNull(heartwormDoses.givenDate),
        isNull(heartwormDoses.remindedAt),
        gte(heartwormDoses.scheduledDate, floor),
        lte(heartwormDoses.scheduledDate, today),
      ),
    )
    .orderBy(asc(heartwormDoses.scheduledDate))
    .all();
  return rows;
}
