"use server";

import { eq, gte, inArray, isNull, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { careVisitItems, careVisits, heartwormDoses } from "@/lib/db/schema";
import {
  careItemsErrorMessage,
  validateCareItems,
  type CareItemDraft,
} from "@/lib/care";
import { isCareKind, isDateOnly, type CareKind } from "@/lib/calendar";
import { generateDoseDates, MAX_GENERATED } from "@/lib/heartworm";
import { nowJstIso } from "@/lib/format";

type ActionResult = { ok: true } | { ok: false; error: string };

const now = nowJstIso;
const MAX_PLACE = 100;
const MAX_NOTE = 500;

function revalidateCare(): void {
  revalidatePath("/care");
  revalidatePath("/calendar");
}

export interface CareVisitInput {
  id?: number;
  kind: CareKind;
  date: string;
  place: string | null;
  note: string | null;
  items: CareItemDraft[];
}

/**
 * 来店記録の保存。明細は毎回まるごと入れ替える（diff を取らない）。
 * 高々数十行なので、順序や欠番を気にするより単純さを取る。
 */
export async function saveCareVisit(
  input: CareVisitInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    if (!isCareKind(input.kind)) return { ok: false, error: "種類が不正です" };
    if (!isDateOnly(input.date)) return { ok: false, error: "日付の形式が正しくありません" };

    const checked = validateCareItems(input.items);
    if (!checked.ok) return { ok: false, error: careItemsErrorMessage(checked.error) };

    const place = input.place?.trim() ? input.place.trim().slice(0, MAX_PLACE) : null;
    const note = input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;

    let visitId: number;
    if (input.id !== undefined) {
      const existing = await db
        .select({ id: careVisits.id })
        .from(careVisits)
        .where(eq(careVisits.id, input.id))
        .get();
      if (!existing) return { ok: false, error: "記録が見つかりません" };
      await db
        .update(careVisits)
        .set({ kind: input.kind, date: input.date, place, note, updatedAt: now() })
        .where(eq(careVisits.id, input.id))
        .run();
      await db.delete(careVisitItems).where(eq(careVisitItems.visitId, input.id)).run();
      visitId = input.id;
    } else {
      const created = await db
        .insert(careVisits)
        .values({
          kind: input.kind,
          date: input.date,
          place,
          note,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning({ id: careVisits.id })
        .get();
      visitId = created.id;
    }

    for (const item of checked.items) {
      await db
        .insert(careVisitItems)
        .values({ visitId, seq: item.seq, name: item.name, amountYen: item.amountYen })
        .run();
    }

    revalidateCare();
    return { ok: true, id: visitId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "保存に失敗しました",
    };
  }
}

export async function deleteCareVisit(id: number): Promise<ActionResult> {
  try {
    // 明細は onDelete: cascade で一緒に消える
    await db.delete(careVisits).where(eq(careVisits.id, id)).run();
    revalidateCare();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "削除に失敗しました",
    };
  }
}

export interface HeartwormPlanInput {
  startMonth: string;
  endMonth: string;
  dayOfMonth: number;
  label: string | null;
}

const PLAN_ERROR: Record<string, string> = {
  "invalid-month": "月の指定が正しくありません",
  "invalid-day": "日は1〜31で指定してください",
  reversed: "終わりの月は始まりの月より後にしてください",
  "too-many": `一度に作れるのは${MAX_GENERATED}件までです`,
};

/**
 * 期間を指定して予定をまとめて作る。
 * すでに同じ日の予定があれば飛ばす（scheduled_date が一意なので
 * onConflictDoNothing がそのまま効く）。やり直しても増殖しない。
 */
export async function generateHeartwormSchedule(
  input: HeartwormPlanInput,
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  try {
    const planned = generateDoseDates({
      startMonth: input.startMonth,
      endMonth: input.endMonth,
      dayOfMonth: input.dayOfMonth,
    });
    if (!planned.ok) {
      return { ok: false, error: PLAN_ERROR[planned.error] ?? "予定を作れませんでした" };
    }

    const label = input.label?.trim() ? input.label.trim().slice(0, 100) : null;
    const existing = new Set(
      (
        await db
          .select({ date: heartwormDoses.scheduledDate })
          .from(heartwormDoses)
          .where(inArray(heartwormDoses.scheduledDate, planned.dates))
          .all()
      ).map((r) => r.date),
    );

    let created = 0;
    for (const date of planned.dates) {
      if (existing.has(date)) continue;
      await db
        .insert(heartwormDoses)
        .values({
          scheduledDate: date,
          label,
          createdAt: now(),
          updatedAt: now(),
        })
        .onConflictDoNothing()
        .run();
      created++;
    }

    revalidateCare();
    return { ok: true, created, skipped: planned.dates.length - created };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "予定の作成に失敗しました",
    };
  }
}

export interface HeartwormRecordInput {
  id: number;
  /** null にすると「まだ飲ませていない」に戻す */
  givenDate: string | null;
  label: string | null;
  note: string | null;
}

/** 飲ませた記録。日付を null にすると未実施に戻せる */
export async function recordHeartwormDose(
  input: HeartwormRecordInput,
): Promise<ActionResult> {
  try {
    if (input.givenDate !== null && !isDateOnly(input.givenDate)) {
      return { ok: false, error: "日付の形式が正しくありません" };
    }
    const existing = await db
      .select({ id: heartwormDoses.id })
      .from(heartwormDoses)
      .where(eq(heartwormDoses.id, input.id))
      .get();
    if (!existing) return { ok: false, error: "予定が見つかりません" };

    await db
      .update(heartwormDoses)
      .set({
        givenDate: input.givenDate,
        label: input.label?.trim() ? input.label.trim().slice(0, 100) : null,
        note: input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null,
        updatedAt: now(),
      })
      .where(eq(heartwormDoses.id, input.id))
      .run();

    revalidateCare();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "保存に失敗しました",
    };
  }
}

export async function deleteHeartwormDose(id: number): Promise<ActionResult> {
  try {
    await db.delete(heartwormDoses).where(eq(heartwormDoses.id, id)).run();
    revalidateCare();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "削除に失敗しました",
    };
  }
}

/** 未実施の予定をまとめて消す。作り直したいときのため（実施済みは残す） */
export async function clearUpcomingHeartwormDoses(
  fromDate: string,
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  try {
    if (!isDateOnly(fromDate)) return { ok: false, error: "日付の形式が正しくありません" };
    const rows = await db
      .select({ id: heartwormDoses.id })
      .from(heartwormDoses)
      .where(
        and(
          isNull(heartwormDoses.givenDate),
          gte(heartwormDoses.scheduledDate, fromDate),
        ),
      )
      .all();
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { ok: true, deleted: 0 };
    await db.delete(heartwormDoses).where(inArray(heartwormDoses.id, ids)).run();
    revalidateCare();
    return { ok: true, deleted: ids.length };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "削除に失敗しました",
    };
  }
}
