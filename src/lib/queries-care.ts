import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { careVisitItems, careVisits, heartwormDoses } from "@/lib/db/schema";
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

export interface HeartwormRow extends DoseRow {
  label: string | null;
  note: string | null;
  remindError: string | null;
}

/** 予定を日付順に。過去も未来もまとめて返す（件数が高々数十のため） */
export async function getHeartwormDoses(): Promise<HeartwormRow[]> {
  const rows = await db
    .select()
    .from(heartwormDoses)
    .orderBy(asc(heartwormDoses.scheduledDate))
    .all();
  return rows.map((r) => ({
    id: r.id,
    scheduledDate: r.scheduledDate,
    givenDate: r.givenDate,
    remindedAt: r.remindedAt,
    label: r.label,
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
