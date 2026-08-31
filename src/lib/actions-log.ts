"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError } from "@/lib/action-error";
import { isDateOnly, isMealSlot, type DateStr, type MealSlot } from "@/lib/calendar";
import {
  deleteBlobs,
  isBlobUrl,
  parseBlobPath,
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
} from "@/lib/blob";
import { db } from "@/lib/db";
import {
  mealEntries,
  products,
  vaccinationPhotos,
  vaccinations,
} from "@/lib/db/schema";
import { nowJstIso } from "@/lib/format";

export type ActionResult = { ok: true } | { ok: false; error: string };

const now = nowJstIso;

const MAX_ENTRIES_PER_SLOT = 10;
const MAX_PHOTOS = 8;

function revalidateLog(): void {
  revalidatePath("/calendar");
  revalidatePath("/");
}

// ------------------------------------------------------------------ 食事記録

export interface MealEntryInput {
  /** 既存行の編集時のみ（createdAt を保つ） */
  id?: number;
  productId: number | null;
  label: string;
  amount: string | null;
  note: string | null;
}

/**
 * 1行ぶんの検証と確定形の解決。label のスナップショットはサーバ権威 —
 * productId があるときは products.name から引き直し、クライアントの
 * label は捨てる（actions.ts の resolveRow と同じ方針）。
 */
async function resolveMealEntry(row: MealEntryInput): Promise<
  | {
      ok: true;
      value: {
        productId: number | null;
        label: string;
        amount: string | null;
        note: string | null;
      };
    }
  | { ok: false; error: string }
> {
  const amount = row.amount?.trim() ? row.amount.trim().slice(0, 50) : null;
  const note = row.note?.trim() ? row.note.trim().slice(0, 500) : null;

  if (row.productId !== null) {
    if (!Number.isInteger(row.productId)) {
      return { ok: false, error: "商品IDが不正です" };
    }
    const product = await db
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, row.productId))
      .get();
    if (!product) return { ok: false, error: "選択された商品が見つかりません" };
    const label = product.name ?? row.label.trim();
    if (!label) return { ok: false, error: "商品名を取得できませんでした" };
    return { ok: true, value: { productId: row.productId, label, amount, note } };
  }

  const label = row.label.trim();
  if (!label) return { ok: false, error: "食べたものを入力してください" };
  if (label.length > 200) {
    return { ok: false, error: "名前は200文字以内で入力してください" };
  }
  return { ok: true, value: { productId: null, label, amount, note } };
}

/**
 * 1スロットぶんをまとめて保存する。ダイアログはスロット全体を編集するので、
 * 1トランザクションで diff-upsert する（saveReceivedBonuses と同型）:
 * id あり → update（createdAt を保つ）/ id なし → insert /
 * ペイロードに無い既存行 → delete。
 */
export async function saveMealSlot(
  date: DateStr,
  slot: MealSlot,
  rows: MealEntryInput[],
): Promise<ActionResult> {
  try {
    if (!isDateOnly(date)) return { ok: false, error: "日付の形式が正しくありません" };
    if (!isMealSlot(slot)) return { ok: false, error: "食事の区分が不正です" };
    if (rows.length > MAX_ENTRIES_PER_SLOT) {
      return {
        ok: false,
        error: `1回の食事に登録できるのは${MAX_ENTRIES_PER_SLOT}品までです`,
      };
    }

    const resolved: Array<{
      id?: number;
      productId: number | null;
      label: string;
      amount: string | null;
      note: string | null;
    }> = [];
    for (const row of rows) {
      const r = await resolveMealEntry(row);
      if (!r.ok) return r;
      resolved.push({ id: row.id, ...r.value });
    }

    await db.transaction(async (tx) => {
      const existingIds = new Set(
        (
          await tx
            .select({ id: mealEntries.id })
            .from(mealEntries)
            .where(and(eq(mealEntries.date, date), eq(mealEntries.slot, slot)))
            .all()
        ).map((r) => r.id),
      );
      const keptIds = new Set<number>();

      for (const [i, row] of resolved.entries()) {
        if (row.id !== undefined && existingIds.has(row.id)) {
          keptIds.add(row.id);
          await tx
            .update(mealEntries)
            .set({
              productId: row.productId,
              label: row.label,
              amount: row.amount,
              note: row.note,
              seq: i,
              updatedAt: now(),
            })
            .where(eq(mealEntries.id, row.id))
            .run();
        } else {
          await tx
            .insert(mealEntries)
            .values({
              date,
              slot,
              seq: i,
              productId: row.productId,
              label: row.label,
              amount: row.amount,
              note: row.note,
              createdAt: now(),
              updatedAt: now(),
            })
            .run();
        }
      }

      for (const id of existingIds) {
        if (!keptIds.has(id)) {
          await tx.delete(mealEntries).where(eq(mealEntries.id, id)).run();
        }
      }
    });

    revalidateLog();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "保存に失敗しました"),
    };
  }
}

/** 「昨日をまるごとコピー」。コピー先の既存記録は置き換える。 */
export async function copyMealDay(
  fromDate: DateStr,
  toDate: DateStr,
): Promise<ActionResult> {
  try {
    if (!isDateOnly(fromDate) || !isDateOnly(toDate)) {
      return { ok: false, error: "日付の形式が正しくありません" };
    }
    if (fromDate === toDate) {
      return { ok: false, error: "同じ日にはコピーできません" };
    }

    const source = await db
      .select()
      .from(mealEntries)
      .where(eq(mealEntries.date, fromDate))
      .orderBy(asc(mealEntries.seq), asc(mealEntries.id))
      .all();
    if (source.length === 0) {
      return { ok: false, error: "コピー元に記録がありません" };
    }

    await db.transaction(async (tx) => {
      await tx.delete(mealEntries).where(eq(mealEntries.date, toDate)).run();
      for (const row of source) {
        await tx
          .insert(mealEntries)
          .values({
            date: toDate,
            slot: row.slot,
            seq: row.seq,
            productId: row.productId,
            label: row.label,
            amount: row.amount,
            note: row.note,
            createdAt: now(),
            updatedAt: now(),
          })
          .run();
      }
    });

    revalidateLog();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "コピーに失敗しました"),
    };
  }
}

/** その日の記録をすべて消す。 */
export async function clearMealDay(date: DateStr): Promise<ActionResult> {
  try {
    if (!isDateOnly(date)) return { ok: false, error: "日付の形式が正しくありません" };
    await db.delete(mealEntries).where(eq(mealEntries.date, date)).run();
    revalidateLog();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "削除に失敗しました"),
    };
  }
}

// ------------------------------------------------------------------ ワクチン

export interface VaccinationInput {
  id?: number;
  date: DateStr;
  name: string;
  clinic: string | null;
  nextDueDate: string | null;
  note: string | null;
}

export async function saveVaccination(
  input: VaccinationInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    if (!isDateOnly(input.date)) {
      return { ok: false, error: "接種日の形式が正しくありません" };
    }
    const name = input.name.trim();
    if (!name) return { ok: false, error: "ワクチン名を入力してください" };
    if (name.length > 100) {
      return { ok: false, error: "ワクチン名は100文字以内で入力してください" };
    }
    const nextDueDate = input.nextDueDate?.trim() || null;
    if (nextDueDate !== null) {
      if (!isDateOnly(nextDueDate)) {
        return { ok: false, error: "次回予定日の形式が正しくありません" };
      }
      if (nextDueDate < input.date) {
        return { ok: false, error: "次回予定日は接種日より後にしてください" };
      }
    }
    const clinic = input.clinic?.trim() ? input.clinic.trim().slice(0, 100) : null;
    const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;

    if (input.id !== undefined) {
      const existing = await db
        .select({ id: vaccinations.id })
        .from(vaccinations)
        .where(eq(vaccinations.id, input.id))
        .get();
      if (!existing) return { ok: false, error: "記録が見つかりません" };
      await db
        .update(vaccinations)
        .set({ date: input.date, name, clinic, nextDueDate, note, updatedAt: now() })
        .where(eq(vaccinations.id, input.id))
        .run();
      revalidateLog();
      return { ok: true, id: input.id };
    }

    const created = await db
      .insert(vaccinations)
      .values({
        date: input.date,
        name,
        clinic,
        nextDueDate,
        note,
        createdAt: now(),
        updatedAt: now(),
      })
      .returning({ id: vaccinations.id })
      .get();

    revalidateLog();
    return { ok: true, id: created.id };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "保存に失敗しました"),
    };
  }
}

/** 記録と一緒に Blob 上の写真も消す（DB を先にコミットし、Blob は best-effort）。 */
export async function deleteVaccination(id: number): Promise<ActionResult> {
  try {
    const photos = await db
      .select({ pathname: vaccinationPhotos.pathname })
      .from(vaccinationPhotos)
      .where(eq(vaccinationPhotos.vaccinationId, id))
      .all();

    const deleted = await db
      .delete(vaccinations)
      .where(eq(vaccinations.id, id))
      .returning({ id: vaccinations.id })
      .get();
    if (!deleted) return { ok: false, error: "記録が見つかりません" };

    await deleteBlobs(photos.map((p) => p.pathname));
    revalidateLog();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "削除に失敗しました"),
    };
  }
}

export interface PhotoMetaInput {
  url: string;
  pathname: string;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
}

/**
 * アップロードはブラウザ → Blob の直行でサーバがバイト列を見ない。
 * よってクライアントが渡すメタデータの検証は、ここが唯一の関門になる。
 */
export async function attachVaccinationPhoto(
  vaccinationId: number,
  meta: PhotoMetaInput,
): Promise<ActionResult> {
  try {
    const record = await db
      .select({ id: vaccinations.id })
      .from(vaccinations)
      .where(eq(vaccinations.id, vaccinationId))
      .get();
    if (!record) return { ok: false, error: "記録が見つかりません" };

    const count = await db
      .select({ n: vaccinationPhotos.id })
      .from(vaccinationPhotos)
      .where(eq(vaccinationPhotos.vaccinationId, vaccinationId))
      .all();
    if (count.length >= MAX_PHOTOS) {
      return { ok: false, error: `写真は${MAX_PHOTOS}枚まで登録できます` };
    }

    if (!isBlobUrl(meta.url)) return { ok: false, error: "写真のURLが不正です" };
    // 接頭辞の許可リストで用途まで見る。startsWith より狭く、
    // vaccinations/a/../b も profile/ のパスもここには入って来られない
    if (parseBlobPath(meta.pathname)?.kind !== "vaccination") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    if (
      meta.contentType &&
      !(ALLOWED_PHOTO_TYPES as readonly string[]).includes(meta.contentType)
    ) {
      return { ok: false, error: "対応していない画像形式です" };
    }
    if (meta.sizeBytes !== null && (meta.sizeBytes < 1 || meta.sizeBytes > MAX_PHOTO_BYTES)) {
      return { ok: false, error: "画像サイズが大きすぎます" };
    }

    await db
      .insert(vaccinationPhotos)
      .values({
        vaccinationId,
        url: meta.url,
        pathname: meta.pathname,
        contentType: meta.contentType,
        sizeBytes: meta.sizeBytes,
        width: meta.width,
        height: meta.height,
        createdAt: now(),
      })
      .run();

    revalidateLog();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の登録に失敗しました"),
    };
  }
}

/**
 * 記録に紐づかなかった写真を Blob から消す。
 *
 * ブラウザ → Blob の直アップロードは成功したのに、そのあとの
 * attachVaccinationPhoto が失敗する経路がある（モバイルの通信断が典型）。
 * そのままだと DB に行が無いので detach でも delete でも消せず、氏名・住所が
 * 写った画像が private ストアに永久に残る。
 *
 * **DB が参照している pathname は絶対に消さない。** クライアント由来の値を
 * 受け取るので、この一行が他の記録の証明書を巻き添えにしない保証になる。
 *
 * **kind ごとに Action を足す。共有 Action を広げない。** これは
 * vaccinations/ 専用で、参照を確かめるのも vaccination_photos だけ。
 * profile/ も受けられるように条件を緩めると、参照チェックが「写真を指しうる
 * 全テーブルの列挙」になり、1つ書き忘れた瞬間に生きた写真が消える。
 * プロフィールには専用の discardUnattachedDogPhoto がある
 * （src/lib/actions-profile.ts）。3つ目の用途も同じ形で足すこと。
 */
export async function discardUnattachedPhoto(pathname: string): Promise<ActionResult> {
  try {
    if (typeof pathname !== "string" || parseBlobPath(pathname)?.kind !== "vaccination") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    const linked = await db
      .select({ id: vaccinationPhotos.id })
      .from(vaccinationPhotos)
      .where(eq(vaccinationPhotos.pathname, pathname))
      .get();
    if (linked) return { ok: false, error: "この写真は記録に紐づいています" };

    await deleteBlobs([pathname]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の削除に失敗しました"),
    };
  }
}

export async function detachVaccinationPhoto(photoId: number): Promise<ActionResult> {
  try {
    const photo = await db
      .delete(vaccinationPhotos)
      .where(eq(vaccinationPhotos.id, photoId))
      .returning({ pathname: vaccinationPhotos.pathname })
      .get();
    if (!photo) return { ok: false, error: "写真が見つかりません" };
    await deleteBlobs([photo.pathname]);
    revalidateLog();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の削除に失敗しました"),
    };
  }
}
