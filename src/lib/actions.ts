"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError } from "@/lib/action-error";
import {
  ALLOWED_ORDER_FILE_TYPES,
  PHOTO_RULES,
  deleteBlobs,
  isBlobUrl,
  parseBlobPath,
} from "@/lib/blob";
import { db } from "@/lib/db";
import { nowJstIso } from "@/lib/format";
import { MAX_ORDER_FILES } from "@/lib/order-files";
import {
  orderFiles,
  orders,
  productFavorites,
  products,
  receivedBonuses,
} from "@/lib/db/schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface DraftRowInput {
  /** present when editing an existing row (preserves createdAt) */
  id?: number;
  productId: number | null;
  label: string;
  quantity: number;
  note: string | null;
}

const now = nowJstIso;

const MAX_ROWS = 20;

/**
 * Validates one draft row and resolves its persisted shape. The label
 * snapshot's authority is server-side: when productId is set, the label is
 * re-derived from products.name and the client-sent label is ignored.
 */
async function resolveRow(row: DraftRowInput): Promise<
  | { ok: true; value: { productId: number | null; label: string; quantity: number; note: string | null } }
  | { ok: false; error: string }
> {
  if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99) {
    return { ok: false, error: "数量は1〜99の整数で入力してください" };
  }
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
    return {
      ok: true,
      value: { productId: row.productId, label, quantity: row.quantity, note },
    };
  }

  const label = row.label.trim();
  if (!label) return { ok: false, error: "おまけの名前を入力してください" };
  if (label.length > 200) {
    return { ok: false, error: "おまけの名前は200文字以内で入力してください" };
  }
  return { ok: true, value: { productId: null, label, quantity: row.quantity, note } };
}

/**
 * The dialog edits the order's WHOLE set of received bonuses; this action
 * diff-upserts in one transaction: rows with id → update (createdAt kept),
 * rows without → insert, existing rows absent from the payload → delete.
 */
export async function saveReceivedBonuses(
  orderId: string,
  rows: DraftRowInput[],
): Promise<ActionResult> {
  try {
    const order = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, orderId))
      .get();
    if (!order) return { ok: false, error: "注文が見つかりません" };
    if (rows.length > MAX_ROWS) {
      return { ok: false, error: `一度に記録できるのは${MAX_ROWS}行までです` };
    }

    const resolved: Array<{
      id?: number;
      productId: number | null;
      label: string;
      quantity: number;
      note: string | null;
    }> = [];
    for (const row of rows) {
      const r = await resolveRow(row);
      if (!r.ok) return r;
      resolved.push({ id: row.id, ...r.value });
    }

    /*
      消える行が持っていた写真の pathname。**トランザクションの外で消す** —
      Blob の削除は取り消せないので、コミットしてから撃つ（行が残ったのに
      実体だけ消える状態を作らない）。
    */
    const orphaned: string[] = [];

    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: receivedBonuses.id, pathname: receivedBonuses.photoPathname })
        .from(receivedBonuses)
        .where(eq(receivedBonuses.orderId, orderId))
        .all();
      const existingIds = new Set(existingRows.map((r) => r.id));
      const keptIds = new Set<number>();

      for (const row of resolved) {
        if (row.id !== undefined && existingIds.has(row.id)) {
          keptIds.add(row.id);
          await tx
            .update(receivedBonuses)
            .set({
              productId: row.productId,
              label: row.label,
              quantity: row.quantity,
              note: row.note,
              updatedAt: now(),
            })
            .where(eq(receivedBonuses.id, row.id))
            .run();
        } else {
          await tx
            .insert(receivedBonuses)
            .values({
              orderId,
              productId: row.productId,
              label: row.label,
              quantity: row.quantity,
              note: row.note,
              createdAt: now(),
              updatedAt: now(),
            })
            .run();
        }
      }

      for (const row of existingRows) {
        if (keptIds.has(row.id)) continue;
        // 行と一緒に写真も消す。ここで拾い忘れると、二度と表示されない
        // 実体がストアに残り続ける（誰も pathname を知らないので消せない）
        if (row.pathname) orphaned.push(row.pathname);
        await tx.delete(receivedBonuses).where(eq(receivedBonuses.id, row.id)).run();
      }
    });

    if (orphaned.length > 0) await deleteBlobs(orphaned);
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "保存に失敗しました"),
    };
  }
}

/** Quick per-row delete from the section list, without opening the dialog. */
export async function deleteReceivedBonus(
  id: number,
  orderId: string,
): Promise<ActionResult> {
  try {
    const row = await db
      .select({ id: receivedBonuses.id, pathname: receivedBonuses.photoPathname })
      .from(receivedBonuses)
      .where(eq(receivedBonuses.id, id))
      .get();
    if (!row) return { ok: false, error: "記録が見つかりません" };
    await db.delete(receivedBonuses).where(eq(receivedBonuses.id, id)).run();
    // 行が消えたら写真の実体も消す（best-effort。DB は既にコミット済み）
    if (row.pathname) await deleteBlobs([row.pathname]);
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "削除に失敗しました"),
    };
  }
}

// --------------------------------------------------------- おまけの写真
//
// 5つ目の Blob の用途なので、**専用の Action を足す**（証明書用・プロフィール
// 用・薬用・注文の添付用の条件を緩めない）。緩めると、参照チェックが
// 「写真を指しうる全テーブルの列挙」になり、1つ書き忘れた瞬間に生きた
// 写真が消える（src/lib/actions-log.ts の discardUnattachedPhoto のコメント）。
//
// 形は薬のパッケージ写真（actions-care.ts の setMedicinePhoto）と同じ —
// 1行に高々1枚で、差し替えたら古い実体を消す。

export interface ReceivedBonusPhotoInput {
  bonusId: number;
  /** 本物のアップロード由来であることの検証にだけ使う（列には保存しない） */
  url: string;
  /** Blob の削除キー＝表示経路の鍵。これだけを保存する */
  pathname: string;
  contentType: string | null;
  sizeBytes: number | null;
}

/**
 * おまけの行に写真を付ける（1行1枚。差し替えると古い写真は消す）。
 *
 * アップロードはブラウザ → Blob の直行でサーバがバイト列を見ないので、
 * クライアントが渡すメタデータの検証はここが唯一の関門になる。
 * 順番は setMedicinePhoto と同じ: url → 保存先の種類 → 形式 → サイズ →
 * 行の存在。
 */
export async function setReceivedBonusPhoto(
  meta: ReceivedBonusPhotoInput,
): Promise<ActionResult> {
  try {
    if (!isBlobUrl(meta.url)) return { ok: false, error: "写真のURLが不正です" };
    if (parseBlobPath(meta.pathname)?.kind !== "bonus") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    const rules = PHOTO_RULES.bonus;
    if (meta.contentType && !rules.types.includes(meta.contentType)) {
      return { ok: false, error: "対応していない画像形式です" };
    }
    if (
      meta.sizeBytes !== null &&
      (meta.sizeBytes < 1 || meta.sizeBytes > rules.maxBytes)
    ) {
      return { ok: false, error: "画像サイズが大きすぎます" };
    }
    if (!Number.isInteger(meta.bonusId)) {
      return { ok: false, error: "おまけのIDが不正です" };
    }

    // orderId も一緒に引く。どのページを作り直すかはこの行だけが知っている
    const existing = await db
      .select({
        orderId: receivedBonuses.orderId,
        pathname: receivedBonuses.photoPathname,
      })
      .from(receivedBonuses)
      .where(eq(receivedBonuses.id, meta.bonusId))
      .get();
    if (!existing) return { ok: false, error: "おまけの記録が見つかりません" };

    await db
      .update(receivedBonuses)
      .set({
        photoPathname: meta.pathname,
        photoContentType: meta.contentType,
        photoSizeBytes: meta.sizeBytes,
        // ?v= のキャッシュ破りの種。差し替えたことがブラウザに伝わる唯一の値
        photoUpdatedAt: now(),
        updatedAt: now(),
      })
      .where(eq(receivedBonuses.id, meta.bonusId))
      .run();

    // ここから best-effort（DB は既にコミット済み）。同じ pathname は消さない —
    // 再送で同じ実体を指したときに、いま上げた写真を落としてしまう
    if (existing.pathname && existing.pathname !== meta.pathname) {
      await deleteBlobs([existing.pathname]);
    }
    revalidatePath(`/orders/${existing.orderId}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の保存に失敗しました"),
    };
  }
}

/** 写真を外す。すでに無ければ何もしない（何度押しても同じ結果）。 */
export async function removeReceivedBonusPhoto(id: number): Promise<ActionResult> {
  try {
    if (!Number.isInteger(id)) return { ok: false, error: "おまけのIDが不正です" };
    const existing = await db
      .select({
        orderId: receivedBonuses.orderId,
        pathname: receivedBonuses.photoPathname,
      })
      .from(receivedBonuses)
      .where(eq(receivedBonuses.id, id))
      .get();
    if (!existing) return { ok: false, error: "おまけの記録が見つかりません" };
    if (!existing.pathname) return { ok: true };

    await db
      .update(receivedBonuses)
      .set({
        photoPathname: null,
        photoContentType: null,
        photoSizeBytes: null,
        photoUpdatedAt: null,
        updatedAt: now(),
      })
      .where(eq(receivedBonuses.id, id))
      .run();

    await deleteBlobs([existing.pathname]);
    revalidatePath(`/orders/${existing.orderId}`);
    revalidatePath("/orders");
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
 * **おまけ専用。** 参照を確かめるのも received_bonuses だけで、他の用途も
 * 受けられるように条件を緩めない（証明書用・プロフィール用・薬用・
 * 注文の添付用にもそれぞれ専用がある）。
 */
export async function discardUnattachedBonusPhoto(
  pathname: string,
): Promise<ActionResult> {
  try {
    if (typeof pathname !== "string" || parseBlobPath(pathname)?.kind !== "bonus") {
      return { ok: false, error: "写真の保存先が不正です" };
    }
    // DB が参照している pathname は絶対に消さない。クライアント由来の値を
    // 受け取るので、この1本が「表示中の写真を消させない」保証になる
    const linked = await db
      .select({ id: receivedBonuses.id })
      .from(receivedBonuses)
      .where(eq(receivedBonuses.photoPathname, pathname))
      .get();
    if (linked) return { ok: false, error: "この写真はおまけに紐づいています" };

    await deleteBlobs([pathname]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "写真の削除に失敗しました"),
    };
  }
}

// ------------------------------------------------------------- お気に入り

/**
 * 星の ON/OFF。**このアプリの DB にだけ書く** — 20and20.pet へは
 * POST も DELETE も送らない。
 *
 * 行は決して消さない。OFF は starred=false の upsert（= 墓標）にする。
 * 消すと「一度も星をつけていない」と区別できなくなり、次回のショップ
 * 取り込みが外したはずの星を復活させてしまう。
 *
 * shop_favorite / source には触らない — あれは取り込みが持つ列
 * （取り込みが starred に触らないのと対称）。
 */
export async function toggleFavorite(
  productId: number,
  next: boolean,
): Promise<{ ok: true; starred: boolean } | { ok: false; error: string }> {
  try {
    if (!Number.isInteger(productId)) {
      return { ok: false, error: "商品IDが不正です" };
    }

    // fetch_status は問わない — 販売終了の商品を「また出たら買いたい」と
    // して星に残すのは正当な使い方
    const product = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .get();
    if (!product) return { ok: false, error: "商品が見つかりません" };

    await db
      .insert(productFavorites)
      .values({
        productId,
        starred: next,
        shopFavorite: false,
        source: "local",
        starredAt: now(),
        createdAt: now(),
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: productFavorites.productId,
        set: { starred: next, starredAt: now(), updatedAt: now() },
      })
      .run();

    // 星で見た目が変わるのは商品一覧・商品詳細・お気に入りの3つ。"/"（ホーム）は
    // 入れない — ホームが出すのは注文の集計とケアの予定だけで、星では1つも動かない。
    revalidatePath("/orders");
    revalidatePath(`/products/${productId}`);
    revalidatePath("/favorites");
    return { ok: true, starred: next };
  } catch (err) {
    return {
      ok: false,
      error: actionError(err, "保存に失敗しました"),
    };
  }
}


// ------------------------------------------------------- 注文の添付ファイル
//
// 4つ目の Blob の用途なので、**専用の Action を足す**（証明書用・プロフィール
// 用・薬用の条件を緩めない）。緩めると、参照チェックが「ファイルを指しうる
// 全テーブルの列挙」になり、1つ書き忘れた瞬間に生きたファイルが消える
// （src/lib/actions-log.ts の discardUnattachedPhoto のコメント参照）。

/** ファイル名の上限。表示のためだけに持つので、長すぎるものは詰める */
const MAX_FILE_NAME = 255;

export interface OrderFileInput {
  orderId: string;
  /** 本物のアップロード由来であることの検証にだけ使う */
  url: string;
  /** Blob の削除キー＝表示経路の鍵。これを保存する */
  pathname: string;
  contentType: string | null;
  sizeBytes: number | null;
  /** 選んだときのファイル名。PDF では唯一の識別なので必須 */
  fileName: string;
  /** 写真のときだけ。PDF は null */
  width: number | null;
  height: number | null;
}

/**
 * 注文にファイルを紐づける。
 *
 * アップロードはブラウザ → Blob の直行でサーバがバイト列を見ないので、
 * クライアントが渡すメタデータの検証はここが唯一の関門になる。
 * 順番は setDogPhoto / attachVaccinationPhoto と同じ:
 * 行の存在 → 枚数 → url → 保存先の種類 → 形式 → サイズ。
 */
export async function attachOrderFile(meta: OrderFileInput): Promise<ActionResult> {
  try {
    const order = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, meta.orderId))
      .get();
    if (!order) return { ok: false, error: "注文が見つかりません" };

    const existing = await db
      .select({ id: orderFiles.id })
      .from(orderFiles)
      .where(eq(orderFiles.orderId, meta.orderId))
      .all();
    if (existing.length >= MAX_ORDER_FILES) {
      return { ok: false, error: `添付は${MAX_ORDER_FILES}件までです` };
    }

    if (!isBlobUrl(meta.url)) return { ok: false, error: "ファイルのURLが不正です" };
    // 接頭辞の許可リストで用途まで見る。orders/ 以外はここに入って来られない
    if (parseBlobPath(meta.pathname)?.kind !== "order") {
      return { ok: false, error: "ファイルの保存先が不正です" };
    }
    if (
      meta.contentType &&
      !(ALLOWED_ORDER_FILE_TYPES as readonly string[]).includes(meta.contentType)
    ) {
      return { ok: false, error: "対応していない形式です（写真か PDF を選んでください）" };
    }
    const max = PHOTO_RULES.order.maxBytes;
    if (meta.sizeBytes !== null && (meta.sizeBytes < 1 || meta.sizeBytes > max)) {
      return { ok: false, error: "ファイルが大きすぎます" };
    }
    const fileName = meta.fileName.trim().slice(0, MAX_FILE_NAME) || "添付ファイル";

    await db
      .insert(orderFiles)
      .values({
        orderId: meta.orderId,
        url: meta.url,
        pathname: meta.pathname,
        contentType: meta.contentType,
        sizeBytes: meta.sizeBytes,
        fileName,
        width: meta.width,
        height: meta.height,
        createdAt: now(),
      })
      .run();

    revalidatePath(`/orders/${meta.orderId}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "添付に失敗しました") };
  }
}

/** 添付を外す。行を消してから実体を消す（順序は detachVaccinationPhoto と同じ） */
export async function detachOrderFile(fileId: number): Promise<ActionResult> {
  try {
    const removed = await db
      .delete(orderFiles)
      .where(eq(orderFiles.id, fileId))
      .returning({ pathname: orderFiles.pathname, orderId: orderFiles.orderId })
      .get();
    if (!removed) return { ok: true };

    await deleteBlobs([removed.pathname]);
    revalidatePath(`/orders/${removed.orderId}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "削除に失敗しました") };
  }
}

/**
 * 上げたが紐づけに失敗したファイルを捨てる（孤児の掃除）。
 *
 * **注文専用。** 参照を確かめるのも order_files だけで、他の用途も受けられる
 * ように条件を緩めない（証明書用・プロフィール用・薬用にもそれぞれ専用がある）。
 */
export async function discardUnattachedOrderFile(
  pathname: string,
): Promise<ActionResult> {
  try {
    if (typeof pathname !== "string" || parseBlobPath(pathname)?.kind !== "order") {
      return { ok: false, error: "ファイルの保存先が不正です" };
    }
    // DB が参照している pathname は絶対に消さない。クライアント由来の値を
    // 受け取るので、この1本が「表示中のファイルを消させない」保証になる
    const linked = await db
      .select({ id: orderFiles.id })
      .from(orderFiles)
      .where(eq(orderFiles.pathname, pathname))
      .get();
    if (linked) return { ok: false, error: "このファイルは注文に紐づいています" };

    await deleteBlobs([pathname]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "削除に失敗しました") };
  }
}
