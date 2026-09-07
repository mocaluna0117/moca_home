import { NextResponse } from "next/server";

import { isBlobConfigured } from "@/lib/blob";
import { etagMatches, photoEtag, photoHeaders } from "@/lib/photo-etag";
import { getReceivedBonusPhoto } from "@/lib/queries";
import { parseIdParam } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 届いたおまけの写真を1枚返す。private な Blob は直リンクで開けないので、
 * 同一オリジンのこのルートが取得して返す（/api/medicine-photos/[id] と
 * 同じ形・同じヘッダー）。middleware の認証ゲートの内側にある。
 *
 * `[id]` は**写真の id**（received_bonus_photos.id）。おまけの行の id では
 * ない — 1つのおまけに複数枚あるので、行の id では1枚を指せない。
 * 行は書き換わらない（付ける／外すだけ）ので `?v=` のキャッシュ破りは不要で、
 * ETag（pathname のハッシュ）だけで「同じ id なら同じバイト列」が成り立つ。
 *
 * **必ず parseIdParam を通す** —
 * parseInt は "1.jpg" を 1 と読むので、素で Number 化すると拡張子付きの
 * URL で実体に届く経路ができる（過去に証明書がその形で未認証配信された。
 * src/lib/route-params.ts のコメント参照）。
 *
 * どの失敗も 404 の JSON で返し、throw しない（一覧のサムネイルは
 * onError で消えるだけで、500 を投げても得るものが無い）。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const photoId = parseIdParam(id);
    if (photoId === null) {
      return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
    }

    const photo = await getReceivedBonusPhoto(photoId);
    if (!photo?.pathname) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // ローカル既定はトークン未設定。ここで 500 を返すと「写真をまだ
    // 付けていない」のと同じ状態が障害に見える
    if (!isBlobConfigured()) {
      return NextResponse.json({ error: "写真の保存先が未設定です" }, { status: 404 });
    }

    // 変わっていなければここで終わり（Blob への往復もバイト列も要らない）
    const etag = photoEtag(photo.pathname);
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: photoHeaders(photo.contentType ?? "image/jpeg", etag),
      });
    }

    const { get } = await import("@vercel/blob");
    const result = await get(photo.pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: photoHeaders(
        photo.contentType ?? result.blob.contentType ?? "image/jpeg",
        etag,
      ),
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
