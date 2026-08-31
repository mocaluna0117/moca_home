"use server";

import { eq, gte, inArray, isNull, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { careVisitItems, careVisits, heartwormDoses, medicines } from "@/lib/db/schema";
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

const MAX_MEDICINE_NAME = 100;

export interface MedicineInput {
  id?: number;
  name: string;
  forHeartworm: boolean;
}

/**
 * 薬の登録・更新。名前は一意なので、同じ名前を2回登録しても増えない。
 * 名前を直すと、その薬を選んである記録の表示も一緒に直る（記録は id を持つ）。
 */
export async function saveMedicine(
  input: MedicineInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const name = input.name.trim();
    if (name === "") return { ok: false, error: "薬の名前を入力してください" };
    if (name.length > MAX_MEDICINE_NAME) {
      return { ok: false, error: `薬の名前は${MAX_MEDICINE_NAME}文字以内で入力してください` };
    }

    const duplicate = await db
      .select({ id: medicines.id })
      .from(medicines)
      .where(eq(medicines.name, name))
      .get();
    if (duplicate && duplicate.id !== input.id) {
      return { ok: false, error: "同じ名前の薬がすでに登録されています" };
    }

    if (input.id !== undefined) {
      const existing = await db
        .select({ id: medicines.id })
        .from(medicines)
        .where(eq(medicines.id, input.id))
        .get();
      if (!existing) return { ok: false, error: "薬が見つかりません" };
      await db
        .update(medicines)
        .set({ name, forHeartworm: input.forHeartworm, updatedAt: now() })
        .where(eq(medicines.id, input.id))
        .run();
      // 写しも合わせて直す。薬を消したあとも読める名前を最新に保つため
      await db
        .update(heartwormDoses)
        .set({ label: name, updatedAt: now() })
        .where(eq(heartwormDoses.medicineId, input.id))
        .run();
      revalidateCare();
      return { ok: true, id: input.id };
    }

    const created = await db
      .insert(medicines)
      .values({
        name,
        forHeartworm: input.forHeartworm,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning({ id: medicines.id })
      .get();
    revalidateCare();
    return { ok: true, id: created.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "保存に失敗しました",
    };
  }
}

/**
 * 薬を消す。**記録は消えない。** 予定側の medicine_id を先に外し、
 * 名前の写し（label）を残すので、過去に何を飲ませたかは読める。
 *
 * DB の外部キーに任せないのは、この列が ALTER TABLE ADD COLUMN で
 * 足されていて REFERENCES 句が付いていないため（schema.ts のコメント参照）。
 * 任せると、存在しない薬IDを指したままの行が残る。
 */
export async function deleteMedicine(id: number): Promise<ActionResult> {
  try {
    await db
      .update(heartwormDoses)
      .set({ medicineId: null, updatedAt: now() })
      .where(eq(heartwormDoses.medicineId, id))
      .run();
    await db.delete(medicines).where(eq(medicines.id, id)).run();
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
  /** 登録済みの薬。null なら未選択 */
  medicineId: number | null;
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

    // 名前は登録側から引く。画面から来た文字列は信用しない
    const medicine =
      input.medicineId === null
        ? null
        : ((await db
            .select({ id: medicines.id, name: medicines.name })
            .from(medicines)
            .where(eq(medicines.id, input.medicineId))
            .get()) ?? null);
    if (input.medicineId !== null && medicine === null) {
      return { ok: false, error: "選んだ薬が見つかりません" };
    }
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
          medicineId: medicine?.id ?? null,
          label: medicine?.name ?? null,
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
  /** 登録済みの薬。null なら未選択 */
  medicineId: number | null;
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

    const medicine =
      input.medicineId === null
        ? null
        : ((await db
            .select({ id: medicines.id, name: medicines.name })
            .from(medicines)
            .where(eq(medicines.id, input.medicineId))
            .get()) ?? null);
    if (input.medicineId !== null && medicine === null) {
      return { ok: false, error: "選んだ薬が見つかりません" };
    }

    await db
      .update(heartwormDoses)
      .set({
        givenDate: input.givenDate,
        medicineId: medicine?.id ?? null,
        label: medicine?.name ?? null,
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
