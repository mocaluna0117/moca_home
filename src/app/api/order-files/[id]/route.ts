import { NextResponse } from "next/server";

import { isBlobConfigured } from "@/lib/blob";
import { etagMatches, photoEtag, photoHeaders } from "@/lib/photo-etag";
import { getOrderFile } from "@/lib/queries";
import { parseIdParam } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 注文の添付ファイルを1件返す。private な Blob は直リンクで開けないので、
 * 同一オリジンのこのルートが取得して返す（/api/medicine-photos/[id] と
 * 同じ形・同じヘッダー）。middleware の認証ゲートの内側にある。
 *
 * **写真と PDF の両方が通る。** Content-Disposition: inline なので、PDF を
 * 別タブで開けばブラウザの PDF ビューアで読める（ダウンロードにならない）。
 *
 * **必ず parseIdParam を通す** — parseInt は "1.jpg" を 1 と読むので、素で
 * Number 化すると拡張子付きのURLで実体に届く経路ができる（過去に証明書が
 * その形で未認証配信された。src/lib/route-params.ts のコメント参照）。
 *
 * ETag を付けて、変わっていなければ 304 を返す（写真のルートと同じ。
 * 添付は一度上げたら変わらないので、ほぼ必ず 304 になる）。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const fileId = parseIdParam(id);
    if (fileId === null) {
      return NextResponse.json({ error: "不正なIDです" }, { status: 400 });
    }

    const file = await getOrderFile(fileId);
    if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (!isBlobConfigured()) {
      return NextResponse.json({ error: "ファイルの保存先が未設定です" }, { status: 404 });
    }

    const contentType = file.contentType ?? "application/octet-stream";
    const etag = photoEtag(file.pathname);
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: photoHeaders(contentType, etag),
      });
    }

    const { get } = await import("@vercel/blob");
    const result = await get(file.pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: photoHeaders(file.contentType ?? result.blob.contentType ?? contentType, etag),
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
