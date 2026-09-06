import { NextResponse } from "next/server";

import { isBlobConfigured } from "@/lib/blob";
import { getMedicinePhoto } from "@/lib/queries-care";
import { parseIdParam } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 薬のパッケージ写真を1枚返す。private な Blob は直リンクで開けないので、
 * 同一オリジンのこのルートが取得して返す（/api/vaccination-photos/[id] と
 * 同じ形・同じヘッダー）。middleware の認証ゲートの内側にある。
 *
 * 薬は複数行あるので /api/dog-photo と違って id を受け取る。**必ず
 * parseIdParam を通す** — parseInt は "1.jpg" を 1 と読むので、素で
 * Number 化すると拡張子付きのURLで実体に届く経路ができる（過去に
 * 証明書がその形で未認証配信された。src/lib/route-params.ts のコメント参照）。
 *
 * どの失敗も 404 の JSON で返し、throw しない（一覧のサムネイルは
 * onError で消えるだけで、500 を投げても得るものが無い）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const medicineId = parseIdParam(id);
    if (medicineId === null) {
      return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
    }

    const photo = await getMedicinePhoto(medicineId);
    if (!photo?.pathname) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // ローカル既定はトークン未設定。ここで 500 を返すと「写真をまだ
    // 付けていない」のと同じ状態が障害に見える
    if (!isBlobConfigured()) {
      return NextResponse.json({ error: "写真の保存先が未設定です" }, { status: 404 });
    }

    const { get } = await import("@vercel/blob");
    const result = await get(photo.pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": photo.contentType ?? result.blob.contentType ?? "image/jpeg",
        // 共有端末でログアウト後に直接URLを開いても配信されないように
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
