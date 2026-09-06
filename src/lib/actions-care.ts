"use server";

import { eq, gte, inArray, isNull, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError } from "@/lib/action-error";
import {
  PHOTO_RULES,
  deleteBlobs,
  isBlobUrl,
  parseBlobPath,
} from "@/lib/blob";
import { db } from "@/lib/db";
import {
  careCourses,
  carePlaces,
  careVisitItems,
  careVisits,
  heartwormDoses,
  medicines,
} from "@/lib/db/schema";
import {
  MAX_COURSE_NAME,
  MAX_PLACE_NAME,
  careItemsErrorMessage,
  isTimeOfDay,
  parseYen,
  validateCareItems,
  type CareItemDraft,
} from "@/lib/care";
import { isCareKind, isDateOnly, type CareKind } from "@/lib/calendar";
import { generateDoseDates, MAX_GENERATED } from "@/lib/heartworm";
import { nowJstIso } from "@/lib/format";

type ActionResult = { ok: true } | { ok: false; error: string };

const now = nowJstIso;
const MAX_NOTE = 500;

/** 「お店」「動物病院」。エラー文と重複チェックの文言に使う */
const PLACE_NOUN: Record<CareKind, string> = { trimming: "お店", hospital: "動物病院" };

function revalidateCare(): void {
  // ケアの記録は種類ごとに別ページになった。どれが変わったかで出し分けず
  // 全部投げる（revalidatePath は冪等で安い。出し分けは書き忘れる側に倒れる）
  revalidatePath("/trimming");
  revalidatePath("/hospital");
  revalidatePath("/heartworm");
  revalidatePath("/medicines");
  revalidatePath("/calendar");
  // ホームの緊急バンドと「次の予定」がフィラリアとトリミングを読むようになった。
  // ここを足さないと「飲ませた」を記録した直後のホームだけ古い予定を出し続ける。
  revalidatePath("/");
}

export interface CareVisitInput {
  id?: number;
  kind: CareKind;
  /** トリミングは予約した日、通院は行った日。未来でもよい */
  date: string;
  /** "HH:MM"。空なら null */
  time: string | null;
  /** 登録したお店を選んだとき。名前は登録側から引く（place は見ない） */
  placeId: number | null;
  /** 自由入力の店名。placeId があるときは無視する */
  place: string | null;
  note: string | null;
  items: CareItemDraft[];
}

/**
 * 来店記録の保存。明細は毎回まるごと入れ替える（diff を取らない）。
 * 高々数十行なので、順序や欠番を気にするより単純さを取る。
 *
 * 日付が未来でもよい（トリミングは予約の記録）。金額は空欄でもよい
 * （validateCareItems が null にして通す）。明細が0行でもよい。
 */
export async function saveCareVisit(
  input: CareVisitInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    if (!isCareKind(input.kind)) return { ok: false, error: "種類が不正です" };
    if (!isDateOnly(input.date)) return { ok: false, error: "日付の形式が正しくありません" };

    // <input type="time"> は "HH:MM"。秒付きで来ても先頭5文字を見る
    const time = input.time?.trim() ? input.time.trim().slice(0, 5) : null;
    if (time !== null && !isTimeOfDay(time)) {
      return { ok: false, error: "時間の形式が正しくありません" };
    }

    const checked = validateCareItems(input.items);
    if (!checked.ok) return { ok: false, error: careItemsErrorMessage(checked.error) };

    // お店は登録から引く（画面から来た文字列は信用しない）。種類も一致させる —
    // 通院の記録にトリミングのお店の id が来ても通さない
    let placeId: number | null = null;
    let place: string | null = null;
    if (input.placeId !== null && input.placeId !== undefined) {
      const registered = await db
        .select({ id: carePlaces.id, name: carePlaces.name })
        .from(carePlaces)
        .where(and(eq(carePlaces.id, input.placeId), eq(carePlaces.kind, input.kind)))
        .get();
      if (!registered) {
        return { ok: false, error: `選んだ${PLACE_NOUN[input.kind]}が見つかりません` };
      }
      placeId = registered.id;
      place = registered.name;
    } else {
      place = input.place?.trim() ? input.place.trim().slice(0, MAX_PLACE_NAME) : null;
    }
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
        .set({
          kind: input.kind,
          date: input.date,
          time,
          placeId,
          place,
          note,
          updatedAt: now(),
        })
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
          time,
          placeId,
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
      error: actionError(err, "保存に失敗しました"),
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
      error: actionError(err, "削除に失敗しました"),
    };
  }
}

// ------------------------------------------------------------ お店・病院

export interface CarePlaceInput {
  id?: number;
  kind: CareKind;
  name: string;
}

/**
 * お店・病院の登録・更新。名前は種類の中で一意なので、同じ名前を2回登録
 * しても増えない。名前を直すと、その店を選んである記録の写し（place）も
 * 一緒に直す（薬と同じ作法）。
 */
export async function saveCarePlace(
  input: CarePlaceInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    if (!isCareKind(input.kind)) return { ok: false, error: "種類が不正です" };
    const noun = PLACE_NOUN[input.kind];
    const name = input.name.trim();
    if (name === "") return { ok: false, error: `${noun}の名前を入力してください` };
    if (name.length > MAX_PLACE_NAME) {
      return { ok: false, error: `${noun}の名前は${MAX_PLACE_NAME}文字以内で入力してください` };
    }

    const duplicate = await db
      .select({ id: carePlaces.id })
      .from(carePlaces)
      .where(and(eq(carePlaces.kind, input.kind), eq(carePlaces.name, name)))
      .get();
    if (duplicate && duplicate.id !== input.id) {
      return { ok: false, error: `同じ名前の${noun}がすでに登録されています` };
    }

    if (input.id !== undefined) {
      const existing = await db
        .select({ id: carePlaces.id })
        .from(carePlaces)
        .where(and(eq(carePlaces.id, input.id), eq(carePlaces.kind, input.kind)))
        .get();
      if (!existing) return { ok: false, error: `${noun}が見つかりません` };
      await db
        .update(carePlaces)
        .set({ name, updatedAt: now() })
        .where(eq(carePlaces.id, input.id))
        .run();
      // 写しも合わせて直す。登録を消したあとも読める名前を最新に保つため
      await db
        .update(careVisits)
        .set({ place: name, updatedAt: now() })
        .where(eq(careVisits.placeId, input.id))
        .run();
      revalidateCare();
      return { ok: true, id: input.id };
    }

    const created = await db
      .insert(carePlaces)
      .values({ kind: input.kind, name, createdAt: now(), updatedAt: now() })
      .returning({ id: carePlaces.id })
      .get();
    revalidateCare();
    return { ok: true, id: created.id };
  } catch (err) {
    return { ok: false, error: actionError(err, "保存に失敗しました") };
  }
}

/**
 * お店・病院の登録を消す。**記録は消えない。** 記録側の place_id を先に外し、
 * 名前の写し（place）を残すので、過去にどこへ行ったかは読める。
 * DB の外部キーに任せない理由は deleteMedicine と同じ（schema.ts のコメント参照）。
 */
export async function deleteCarePlace(id: number): Promise<ActionResult> {
  try {
    await db
      .update(careVisits)
      .set({ placeId: null, updatedAt: now() })
      .where(eq(careVisits.placeId, id))
      .run();
    await db.delete(carePlaces).where(eq(carePlaces.id, id)).run();
    revalidateCare();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "削除に失敗しました") };
  }
}

// ------------------------------------------------------------------ コース

export interface CareCourseInput {
  id?: number;
  kind: CareKind;
  name: string;
  /** 画面から来る生の文字列。空なら金額未設定 */
  price: string;
}

/**
 * コースの登録・更新。名前は種類の中で一意。
 * 明細はコースを参照しない（名前と金額を写すだけ）ので、ここで名前や金額を
 * 直しても過去の記録は変わらない。
 */
export async function saveCareCourse(
  input: CareCourseInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    if (!isCareKind(input.kind)) return { ok: false, error: "種類が不正です" };
    const name = input.name.trim();
    if (name === "") return { ok: false, error: "コースの名前を入力してください" };
    if (name.length > MAX_COURSE_NAME) {
      return { ok: false, error: `コースの名前は${MAX_COURSE_NAME}文字以内で入力してください` };
    }
    let priceYen: number | null = null;
    if (input.price.trim() !== "") {
      priceYen = parseYen(input.price);
      if (priceYen === null) {
        return { ok: false, error: "金額を数字で入力するか、空欄にしてください" };
      }
    }

    const duplicate = await db
      .select({ id: careCourses.id })
      .from(careCourses)
      .where(and(eq(careCourses.kind, input.kind), eq(careCourses.name, name)))
      .get();
    if (duplicate && duplicate.id !== input.id) {
      return { ok: false, error: "同じ名前のコースがすでに登録されています" };
    }

    if (input.id !== undefined) {
      const existing = await db
        .select({ id: careCourses.id })
        .from(careCourses)
        .where(and(eq(careCourses.id, input.id), eq(careCourses.kind, input.kind)))
        .get();
      if (!existing) return { ok: false, error: "コースが見つかりません" };
      await db
        .update(careCourses)
        .set({ name, priceYen, updatedAt: now() })
        .where(eq(careCourses.id, input.id))
        .run();
      revalidateCare();
      return { ok: true, id: input.id };
    }

    const created = await db
      .insert(careCourses)
      .values({ kind: input.kind, name, priceYen, createdAt: now(), updatedAt: now() })
      .returning({ id: careCourses.id })
      .get();
    revalidateCare();
    return { ok: true, id: created.id };
  } catch (err) {
    return { ok: false, error: actionError(err, "保存に失敗しました") };
  }
}

/** コースを消す。明細は名前と金額の写しを持つので、記録は変わらない。 */
export async function deleteCareCourse(id: number): Promise<ActionResult> {
  try {
    await db.delete(careCourses).where(eq(careCourses.id, id)).run();
    revalidateCare();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "削除に失敗しました") };
  }
}

// ---------------------------------------------------------------------- 薬

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
      error: actionError(err, "保存に失敗しました"),
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
      error: actionError(err, "削除に失敗しました"),
    };
  }
}

// ------------------------------------------------------------- 薬の写真
//
// 3つ目の用途なので、**専用の Action を足す**（既存の証明書用・プロフィール用の
// 条件を緩めない）。緩めると、参照チェックが「写真を指しうる全テーブルの
// 列挙」になり、1つ書き忘れた瞬間に生きた写真が消える
// （src/lib/actions-log.ts の discardUnattachedPhoto のコメント参照）。

export interface MedicinePhotoInput {
  medicineId: number;
  /** 本物のアップロード由来であることの検証にだけ使う（列には保存しない） */
  url: string;
  /** Blob の削除キー＝表示経路の鍵。これだけを保存する */
  pathname: string;
  contentType: string | null;
  sizeBytes: number | null;
}

/**
 * 薬にパッケージ写真を付ける（1薬1枚。差し替えると古い写真は消す）。
 *
 * アップロードはブラウザ → Blob の直行でサーバがバイト列を見ないので、
 * クライアントが渡すメタデータの検証はここが唯一の関門になる。
 * 順番は setDogPhoto と同じ: url → 保存先の種類 → 形式 → サイズ → 行の存在。
 */
export async function setMedicinePhoto(
  meta: MedicinePhotoInput,
): Promise<ActionResult> {
  try {
    if (!isBlobUrl(meta.url)) return { ok: false, error: "写真のURLが不正です" };
    if (parseBlobPath(meta.pathname)?.kind !== "medicine") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    const rules = PHOTO_RULES.medicine;
    if (meta.contentType && !rules.types.includes(meta.contentType)) {
      return { ok: false, error: "対応していない画像形式です" };
    }
    if (meta.sizeBytes !== null && (meta.sizeBytes < 1 || meta.sizeBytes > rules.maxBytes)) {
      return { ok: false, error: "画像サイズが大きすぎます" };
    }

    const existing = await db
      .select({ pathname: medicines.photoPathname })
      .from(medicines)
      .where(eq(medicines.id, meta.medicineId))
      .get();
    if (!existing) return { ok: false, error: "薬が見つかりません" };

    await db
      .update(medicines)
      .set({
        photoPathname: meta.pathname,
        photoContentType: meta.contentType,
        photoSizeBytes: meta.sizeBytes,
        // ?v= のキャッシュ破りの種。差し替えたことがブラウザに伝わる唯一の値
        photoUpdatedAt: now(),
        updatedAt: now(),
      })
      .where(eq(medicines.id, meta.medicineId))
      .run();

    // ここから best-effort（DB は既にコミット済み）。同じ pathname は消さない —
    // 再送で同じ実体を指したときに、いま上げた写真を落としてしまう
    if (existing.pathname && existing.pathname !== meta.pathname) {
      await deleteBlobs([existing.pathname]);
    }
    revalidateCare();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の保存に失敗しました"),
    };
  }
}

/** 写真を外す。すでに無ければ何もしない（何度押しても同じ結果）。 */
export async function removeMedicinePhoto(medicineId: number): Promise<ActionResult> {
  try {
    const existing = await db
      .select({ pathname: medicines.photoPathname })
      .from(medicines)
      .where(eq(medicines.id, medicineId))
      .get();
    if (!existing) return { ok: false, error: "薬が見つかりません" };
    if (!existing.pathname) return { ok: true };

    await db
      .update(medicines)
      .set({
        photoPathname: null,
        photoContentType: null,
        photoSizeBytes: null,
        photoUpdatedAt: null,
        updatedAt: now(),
      })
      .where(eq(medicines.id, medicineId))
      .run();

    await deleteBlobs([existing.pathname]);
    revalidateCare();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の削除に失敗しました"),
    };
  }
}

/**
 * 上げたが紐づけに失敗した写真を捨てる（孤児の掃除）。
 *
 * **薬専用。** 参照を確かめるのも medicines だけで、他の用途も受けられる
 * ように条件を緩めない（証明書用・プロフィール用にもそれぞれ専用がある）。
 */
export async function discardUnattachedMedicinePhoto(
  pathname: string,
): Promise<ActionResult> {
  try {
    if (typeof pathname !== "string" || parseBlobPath(pathname)?.kind !== "medicine") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    // DB が参照している pathname は絶対に消さない。クライアント由来の値を
    // 受け取るので、この1本が「表示中の写真を消させない」保証になる
    const linked = await db
      .select({ id: medicines.id })
      .from(medicines)
      .where(eq(medicines.photoPathname, pathname))
      .get();
    if (linked) return { ok: false, error: "この写真は薬に紐づいています" };

    await deleteBlobs([pathname]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の削除に失敗しました"),
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
      error: actionError(err, "予定の作成に失敗しました"),
    };
  }
}

export interface HeartwormRecordInput {
  id: number;
  /** 予定日そのもの。あとから動かせる（一括生成した日をずらす手段） */
  scheduledDate: string;
  /** null にすると「まだ飲ませていない」に戻す */
  givenDate: string | null;
  /** 登録済みの薬。null なら未選択 */
  medicineId: number | null;
  note: string | null;
}

/**
 * 1件の予定を編集する。予定日・飲ませた日・薬・メモを1回で保存し、
 * 飲ませた日を null にすると未実施に戻せる。
 *
 * **予定日は一意**（heartworm_doses_scheduled_date_idx）。同じ日に2件を
 * 作らないためのもので、素の UPDATE で他の予定と同じ日に動かすと例外になる。
 * saveCarePlace / saveMedicine と同じく、先に引いて日本語で返す。
 */
export async function recordHeartwormDose(
  input: HeartwormRecordInput,
): Promise<ActionResult> {
  try {
    if (!isDateOnly(input.scheduledDate)) {
      return { ok: false, error: "予定日の形式が正しくありません" };
    }
    if (input.givenDate !== null && !isDateOnly(input.givenDate)) {
      return { ok: false, error: "日付の形式が正しくありません" };
    }
    const existing = await db
      .select({ id: heartwormDoses.id })
      .from(heartwormDoses)
      .where(eq(heartwormDoses.id, input.id))
      .get();
    if (!existing) return { ok: false, error: "予定が見つかりません" };

    const duplicate = await db
      .select({ id: heartwormDoses.id })
      .from(heartwormDoses)
      .where(eq(heartwormDoses.scheduledDate, input.scheduledDate))
      .get();
    if (duplicate && duplicate.id !== input.id) {
      return { ok: false, error: "その日にはすでに別の予定があります" };
    }

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
        scheduledDate: input.scheduledDate,
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
      error: actionError(err, "保存に失敗しました"),
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
      error: actionError(err, "削除に失敗しました"),
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
      error: actionError(err, "削除に失敗しました"),
    };
  }
}
