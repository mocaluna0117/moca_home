"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError } from "@/lib/action-error";
import {
  isDateOnly,
  isMealSlot,
  todayJst,
  type DateStr,
  type MealSlot,
} from "@/lib/calendar";
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
  usualMeals,
  vaccinationPhotos,
  vaccinations,
} from "@/lib/db/schema";
import { nowJstIso } from "@/lib/format";
import { deletableIds } from "@/lib/meal-slot-diff";
import { getUsualMeals } from "@/lib/queries-log";
import {
  isUsualSlot,
  planUsualApply,
  type UsualItem,
  type UsualSlot,
} from "@/lib/usual-meals";

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
 * **ダイアログが見ていた**のにペイロードに無い既存行 → delete。
 *
 * `knownIds` はダイアログを開いた時点で見えていた id。削除をそこまで狭める
 * 理由は下の deletableIds の呼び出しと、その doc（src/lib/meal-slot-diff.ts）。
 */
export async function saveMealSlot(
  date: DateStr,
  slot: MealSlot,
  rows: MealEntryInput[],
  knownIds: number[],
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
      // 配列でも持つ: deletableIds は existingIds の順に返すので、
      // DELETE を撃つ順が入力で決まる（テストで並びを固定できる）
      const existing = (
        await tx
          .select({ id: mealEntries.id })
          .from(mealEntries)
          .where(and(eq(mealEntries.date, date), eq(mealEntries.slot, slot)))
          .all()
      ).map((r) => r.id);
      const existingIds = new Set(existing);
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

      // 消すのは飼い主に**見えていた**行だけ。ダイアログは触っていない
      // スロットも毎回まとめて送るので、素の差分だとこう踏む:
      //   07:59 ダイアログを開く（朝ごはんは0品）
      //   08:00 cron が applyUsualMeals で朝ごはんを2品入れる
      //   08:01 夜だけ入れて保存 → 朝のペイロードは空 →
      //         入ったばかりの2行が黙って消える
      // knownIds に無い行は「消す意思を示されていない行」なので放置する
      for (const id of deletableIds({
        existingIds: existing,
        knownIds,
        keptIds: [...keptIds],
      })) {
        await tx.delete(mealEntries).where(eq(mealEntries.id, id)).run();
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

// ------------------------------------------------------------------ いつものご飯

/**
 * 「いつものご飯」の1スロットぶんを登録する。形は saveMealSlot と同じ
 * diff-upsert（id あり → update / id なし → insert / ペイロードに無い
 * 既存行 → delete）。
 *
 * **ここは素の差分で正しい。** この表に書き込むのは登録ダイアログだけで、
 * 時刻で行を作る書き手がいない（saveMealSlot が deletableIds で削除を
 * 狭めているのは、cron が入れた meal_entries の行を守るためだけの話）。
 *
 * `rows` が空配列で来るのが**オフの手段**（「登録を消す」）。エラーにしない —
 * 品目0件のスロットは planUsualApply が落とすので、それだけで自動記録は止まる。
 *
 * 保存のあと同じ applyUsualMeals() を呼ぶので、登録したその日から効果が見える。
 * 戻りの `appliedToday` は「今日のぶんも入ったか」。記録に「いつもの」印を
 * 付けない決定の代わりに、これがダイアログの唯一のフィードバックになる。
 */
export async function saveUsualMealSlot(
  slot: UsualSlot,
  rows: MealEntryInput[],
): Promise<{ ok: true; appliedToday: boolean } | { ok: false; error: string }> {
  try {
    if (!isUsualSlot(slot)) return { ok: false, error: "食事の区分が不正です" };
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
            .select({ id: usualMeals.id })
            .from(usualMeals)
            .where(eq(usualMeals.slot, slot))
            .all()
        ).map((r) => r.id),
      );
      const keptIds = new Set<number>();

      for (const [i, row] of resolved.entries()) {
        if (row.id !== undefined && existingIds.has(row.id)) {
          keptIds.add(row.id);
          await tx
            .update(usualMeals)
            .set({
              productId: row.productId,
              label: row.label,
              amount: row.amount,
              note: row.note,
              seq: i,
              updatedAt: now(),
            })
            .where(eq(usualMeals.id, row.id))
            .run();
        } else {
          await tx
            .insert(usualMeals)
            .values({
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
          await tx.delete(usualMeals).where(eq(usualMeals.id, id)).run();
        }
      }
    });

    // 適用は**いま保存したスロットだけ**。全スロットに適用すると、その日
    // わざと空にしたもう片方を巻き戻してしまう（夜を消した日に朝の登録を
    // 直すと夜が復活する。設計審査で実際に出た欠陥）。
    // cron は applyUsualMeals で両方を見る — あちらは日付が毎回変わるので
    // 同じ問題が起きない。
    const stamp = nowJstIso();
    const today = todayJst(stamp);
    const mine = planUsualApply(await getUsualMeals()).find((p) => p.slot === slot);
    // 登録を空にした（自動記録をやめた）ときは mine が無い = 何も入れない
    const applied = mine
      ? (await applyUsualSlot(slot, mine.items, today, stamp)) === "written"
      : false;

    revalidateLog();
    // ダイアログのトーストはこの1つの真偽だけを見る。全スロットの合計から
    // 導くと、朝を保存したのに夜が入った日に「今日のぶんも記録しました」と
    // 嘘をつく（印を付けない設計では、このトーストが唯一のフィードバック）
    return { ok: true, appliedToday: applied };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "保存に失敗しました"),
    };
  }
}

/**
 * 登録してある「いつものご飯」を**今日**の記録として入れる。
 * 呼び出し元は毎朝8時の cron（/api/cron/daily）と、登録を保存した直後の2つ。
 *
 * 冪等性の組み立て（この5点が崩れたら「いつ適用したか」の台帳が必要になる）:
 *  1. **この経路の文は INSERT だけ**。UPDATE も DELETE も無いので、すでに
 *     ある行を書き換えたり消したりできない
 *  2. INSERT の門は「その (today, slot) が空」の1点。一度成功すれば空では
 *     なくなるので、同じ日の2回目・手で叩いた curl・二重送信はどれも何も
 *     書かない（**N回 ≡ 1回**）
 *  3. 門の読み取りと INSERT は**同一トランザクション**。libsql の
 *     db.transaction() は BEGIN IMMEDIATE で書き込みを直列化するので、
 *     同時に走った2本が両方「空」を見ることはない。UNIQUE 索引に頼らない
 *  4. `today` は引数ではなく中で導出する。どの呼び出し元も別の日付を
 *     指定できない ＝「遡らない」がチェックではなく構造
 *  5. 飼い主が日中に編集・削除した内容は巻き戻らない。朝8時に朝・夜を
 *     まとめて書くので、ある日付についての自動の判断は常に飼い主の操作より
 *     **先**に来ており、翌朝の実行は別の日付を見る
 *
 * **これは "use server" の export なので、そのまま叩けるエンドポイントでも
 * ある。** セッションゲートの内側・引数なし・冪等なので、最悪でも cron と
 * 同じことしかできない。**`date` 引数を足してはいけない** — 足した瞬間に
 * 遡りが開く。「印なし」の決定により空のスロットは「まだ入れていない」と
 * 「わざと空にした」を区別できず、過去の日を埋めると飼い主が消した記録を
 * 復活させてしまう。
 *
 * 部分適用はしない: 登録した商品が products から消えていて1品でも解決
 * できなければ、そのスロットは丸ごと見送る（食べた品数が嘘になるくらいなら
 * 空のほうが良い）。エラーにはしない — 飼い主がその場でできることは無く、
 * もう片方のスロットとフィラリアのリマインドは走らせたいため。
 */
/** applyUsualSlot の結果。数えるためだけでなく、呼び出し側の言い分も変える */
type UsualSlotOutcome = "written" | "occupied" | "unresolved";

/**
 * 1スロットぶんを今日に実体化する。**門もここが持つ。**
 *
 * cron（全スロット）と登録の保存（そのスロットだけ）が**同じ判断**を使うために
 * 切り出してある。保存のあとに全スロットへ適用すると、その日わざと空にした
 * もう片方を巻き戻す。
 *
 * 部分適用はしない: 登録した商品が products から消えていて1品でも解決
 * できなければ "unresolved" を返して1行も書かない（食べた品数が嘘になる
 * くらいなら空のほうが良い）。
 */
async function applyUsualSlot(
  slot: UsualSlot,
  items: readonly UsualItem[],
  today: DateStr,
  stamp: string,
): Promise<UsualSlotOutcome> {
  // 先に全品を解決する。商品名はサーバ権威で引き直される
  const values: Array<{
    productId: number | null;
    label: string;
    amount: string | null;
    note: string | null;
  }> = [];
  for (const item of items) {
    const r = await resolveMealEntry(item);
    if (!r.ok) return "unresolved";
    values.push(r.value);
  }

  const wrote = await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: mealEntries.id })
      .from(mealEntries)
      .where(and(eq(mealEntries.date, today), eq(mealEntries.slot, slot)))
      .limit(1)
      .get();
    // 1行でもあれば何も書かない。設計全体がこの1行に乗っている。
    // 門の読み取りとこの下の INSERT が同一トランザクションなのが要点で、
    // 同時に走った2つの実行が両方「空」を見ることはない
    if (existing) return false;
    for (const [i, row] of values.entries()) {
      await tx
        .insert(mealEntries)
        .values({
          date: today,
          slot,
          seq: i,
          productId: row.productId,
          label: row.label,
          amount: row.amount,
          note: row.note,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .run();
    }
    return true;
  });

  return wrote ? "written" : "occupied";
}

export async function applyUsualMeals(): Promise<
  | {
      ok: true;
      today: DateStr;
      created: number;
      /** すでに記録があって見送ったスロット数（正常） */
      skipped: number;
      /** 商品が解決できず丸ごと見送ったスロット数（**放置すると毎日入らない**） */
      unresolved: number;
    }
  | { ok: false; error: string }
> {
  try {
    // 「今日」の出どころはこの2行だけ。1回の実行が2つの「今日」に
    // またがらないよう、時刻もここで1回だけ採る（reminder.ts と同じ）
    const stamp = nowJstIso();
    const today = todayJst(stamp);

    // 固定順 朝 → 夜。品目0件のスロットは planUsualApply が落とすので、
    // 登録を空にすればそれだけで自動記録は止まる
    const plan = planUsualApply(await getUsualMeals());
    let created = 0;
    let skipped = 0;
    let unresolved = 0;

    for (const { slot, items } of plan) {
      const outcome = await applyUsualSlot(slot, items, today, stamp);
      // 数えるのはコミットの後。ロールバックした分を created に足さない
      if (outcome === "written") created += items.length;
      else if (outcome === "occupied") skipped += 1;
      else unresolved += 1;
    }

    if (created > 0) revalidateLog();
    // skipped と unresolved を分けるのは、cron の JSON が唯一の診断面だから。
    // 「すでに記録がある」（正常）と「商品が消えていて毎日入らない」を
    // 同じ数字にすると、後者が画面上「まだ」と出るだけで永久に気づけない
    return { ok: true, today, created, skipped, unresolved };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "いつものご飯の記録に失敗しました"),
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
