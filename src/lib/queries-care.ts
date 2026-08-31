import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { careVisitItems, careVisits, heartwormDoses, medicines } from "@/lib/db/schema";
import { totalYen } from "@/lib/care";
import type { CareKind, DateStr } from "@/lib/calendar";
import type { DoseRow } from "@/lib/heartworm";

export interface CareItemRow {
  id: number;
  seq: number;
  name: string;
  amountYen: number;
}

export interface CareVisitRow {
  id: number;
  kind: CareKind;
  date: DateStr;
  place: string | null;
  note: string | null;
  items: CareItemRow[];
  /** 明細から計算する。DBには合計の列を持たない */
  totalYen: number;
}

/**
 * ある種類の来店記録を新しい順に。明細は1回の追加クエリでまとめて引く
 * （getOrders と同じく N+1 を作らない）。
 */
export async function getCareVisits(kind: CareKind): Promise<CareVisitRow[]> {
  const rows = await db
    .select()
    .from(careVisits)
    .where(eq(careVisits.kind, kind))
    .orderBy(desc(careVisits.date), desc(careVisits.id))
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
      place: r.place,
      note: r.note,
      items: own,
      totalYen: totalYen(own),
    };
  });
}

export interface CareYearTotal {
  year: string;
  visits: number;
  totalYen: number;
}

/** 年ごとの回数と金額。「今年いくら使ったか」に答えるため */
export async function getCareYearTotals(kind: CareKind): Promise<CareYearTotal[]> {
  const rows = await db
    .select({
      year: sql<string>`substr(${careVisits.date}, 1, 4)`,
      visits: sql<number>`count(distinct ${careVisits.id})`,
      total: sql<number>`coalesce(sum(${careVisitItems.amountYen}), 0)`,
    })
    .from(careVisits)
    .leftJoin(careVisitItems, eq(careVisitItems.visitId, careVisits.id))
    .where(eq(careVisits.kind, kind))
    .groupBy(sql`substr(${careVisits.date}, 1, 4)`)
    .orderBy(desc(sql`substr(${careVisits.date}, 1, 4)`))
    .all();
  return rows.map((r) => ({ year: r.year, visits: r.visits, totalYen: r.total }));
}

/** カレンダーのマスに印を出すため、その月に来店した日だけ */
export async function getCareDates(
  startDate: DateStr,
  endExclusive: DateStr,
): Promise<Map<DateStr, CareKind[]>> {
  const rows = await db
    .select({ date: careVisits.date, kind: careVisits.kind })
    .from(careVisits)
    .where(and(gte(careVisits.date, startDate), lte(careVisits.date, endExclusive)))
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
 * limit の既定が 4 なのは、トリミングの周期を中央値で言うのに
 * 間隔3本 = 日付4件が要るため（src/lib/home.ts の
 * TRIM_REQUIRED_INTERVALS がその 3 を持つ）。
 */
export async function getRecentCareDates(
  kind: CareKind,
  limit = 4,
): Promise<DateStr[]> {
  const rows = await db
    .select({ date: careVisits.date })
    .from(careVisits)
    .where(eq(careVisits.kind, kind))
    .orderBy(desc(careVisits.date), desc(careVisits.id))
    .limit(limit)
    .all();
  return rows.map((r) => r.date);
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
