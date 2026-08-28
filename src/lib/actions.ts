"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { nowJstIso } from "@/lib/format";
import { orders, products, receivedBonuses } from "@/lib/db/schema";

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
function resolveRow(row: DraftRowInput):
  | { ok: true; value: { productId: number | null; label: string; quantity: number; note: string | null } }
  | { ok: false; error: string } {
  if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99) {
    return { ok: false, error: "数量は1〜99の整数で入力してください" };
  }
  const note = row.note?.trim() ? row.note.trim().slice(0, 500) : null;

  if (row.productId !== null) {
    if (!Number.isInteger(row.productId)) {
      return { ok: false, error: "商品IDが不正です" };
    }
    const product = db
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
    const order = db
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
      const r = resolveRow(row);
      if (!r.ok) return r;
      resolved.push({ id: row.id, ...r.value });
    }

    db.transaction((tx) => {
      const existingIds = new Set(
        tx
          .select({ id: receivedBonuses.id })
          .from(receivedBonuses)
          .where(eq(receivedBonuses.orderId, orderId))
          .all()
          .map((r) => r.id),
      );
      const keptIds = new Set<number>();

      for (const row of resolved) {
        if (row.id !== undefined && existingIds.has(row.id)) {
          keptIds.add(row.id);
          tx.update(receivedBonuses)
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
          tx.insert(receivedBonuses)
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
          tx.delete(receivedBonuses).where(eq(receivedBonuses.id, id)).run();
        }
      }
    });

    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/");
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
    const row = db
      .select({ id: receivedBonuses.id })
      .from(receivedBonuses)
      .where(eq(receivedBonuses.id, id))
      .get();
    if (!row) return { ok: false, error: "記録が見つかりません" };
    db.delete(receivedBonuses).where(eq(receivedBonuses.id, id)).run();
    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "削除に失敗しました",
    };
  }
}
