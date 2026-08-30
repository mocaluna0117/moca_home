import { NextResponse } from "next/server";

import { getFavoriteProductIds } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * 星がついている商品IDだけ（数十バイト）。
 * ピッカーは本体1,120件をセッション中1回しか取らないので、星の変化は
 * この軽いエンドポイントをダイアログを開くたびに叩いて拾う。
 */
export async function GET() {
  const ids = await getFavoriteProductIds();
  return NextResponse.json(
    { ids: [...ids] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
