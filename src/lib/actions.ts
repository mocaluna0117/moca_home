"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { nowJstIso } from "@/lib/format";
import {
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

    await db.transaction(async (tx) => {
      const existingIds = new Set(
        (
          await tx
            .select({ id: receivedBonuses.id })
            .from(receivedBonuses)
            .where(eq(receivedBonuses.orderId, orderId))
            .all()
        ).map((r) => r.id),
      );
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

      for (const id of existingIds) {
        if (!keptIds.has(id)) {
          await tx.delete(receivedBonuses).where(eq(receivedBonuses.id, id)).run();
        }
      }
    });

    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "保存に失敗しました",
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
      .select({ id: receivedBonuses.id })
      .from(receivedBonuses)
      .where(eq(receivedBonuses.id, id))
      .get();
    if (!row) return { ok: false, error: "記録が見つかりません" };
    await db.delete(receivedBonuses).where(eq(receivedBonuses.id, id)).run();
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "削除に失敗しました",
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
      error: err instanceof Error ? err.message : "保存に失敗しました",
    };
  }
}
