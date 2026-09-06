"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError } from "@/lib/action-error";
import { db } from "@/lib/db";
import { productShortNames, products } from "@/lib/db/schema";
import { nowJstIso } from "@/lib/format";
import { MAX_SHORT_NAME } from "@/lib/short-name";

type ActionResult = { ok: true } | { ok: false; error: string };

const now = nowJstIso;

/** 短い名前を変えたら、それを描いている画面すべてを作り直す */
function revalidateNames(productId: number): void {
  revalidatePath(`/products/${productId}`);
  revalidatePath("/calendar");
  revalidatePath("/meals");
  revalidatePath("/");
}

export interface ProductShortNameInput {
  productId: number;
  shortName: string;
}

/**
 * 商品に短い名前を付ける（すでにあれば置き換える）。
 *
 * products テーブルには書かない。あちらはスクレイパが上書きする領域で、
 * 同期のたびに手で入れた名前が消える（schema.ts の product_short_names 参照）。
 */
export async function setProductShortName(
  input: ProductShortNameInput,
): Promise<ActionResult> {
  try {
    if (!Number.isInteger(input.productId)) {
      return { ok: false, error: "商品IDが不正です" };
    }
    const shortName = input.shortName.trim();
    if (shortName === "") return { ok: false, error: "短い名前を入力してください" };
    if (shortName.length > MAX_SHORT_NAME) {
      return { ok: false, error: `短い名前は${MAX_SHORT_NAME}文字以内で入力してください` };
    }

    // 存在しない商品IDで行を作らない（外部キーは ALTER 経由ではないので効くが、
    // 画面に出すのは日本語のほうが直せる）
    const product = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, input.productId))
      .get();
    if (!product) return { ok: false, error: "商品が見つかりません" };

    await db
      .insert(productShortNames)
      .values({
        productId: input.productId,
        shortName,
        createdAt: now(),
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: productShortNames.productId,
        set: { shortName, updatedAt: now() },
      })
      .run();

    revalidateNames(input.productId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "保存に失敗しました") };
  }
}

/**
 * 短い名前をやめる。行ごと消す（product_favorites の starred=false のような
 * 墓標は要らない — 取り込みで復活する経路が無い）。以後は今までどおり
 * 商品名からの推定（core-name.ts）で短くする。
 */
export async function clearProductShortName(productId: number): Promise<ActionResult> {
  try {
    await db
      .delete(productShortNames)
      .where(eq(productShortNames.productId, productId))
      .run();
    revalidateNames(productId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err, "削除に失敗しました") };
  }
}
