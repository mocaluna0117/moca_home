import { NextResponse } from "next/server";

import { isBlobConfigured } from "@/lib/blob";
import { parseIdParam } from "@/lib/route-params";
import { getVaccinationPhoto } from "@/lib/queries-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * private な Blob は直リンクで開けないので、同一オリジンのこのルートが
 * 取得して返す。DB の id で引くため、パスを総当たりされても他の blob には
 * 到達できない。middleware の認証ゲートの内側にある。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // parseInt を使わない。"1.jpg" が 1 と読まれ、拡張子つきURLで
  // middleware を迂回されていた（src/lib/route-params.ts のコメント参照）
  const photoId = parseIdParam(id);
  if (photoId === null) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const photo = await getVaccinationPhoto(photoId);
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!isBlobConfigured()) {
    return NextResponse.json({ error: "写真の保存先が未設定です" }, { status: 404 });
  }

  try {
    const { get } = await import("@vercel/blob");
    // private ストアの読み出しはトークンが要る。get() がそれを担う。
    const result = await get(photo.pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type":
          photo.contentType ?? result.blob.contentType ?? "image/jpeg",
        // 家族と共有する端末で、ログアウト後に直接URLを開いたときに
        // ブラウザキャッシュから配信されてしまわないようにする。
        // 1枚1MB以下・同一オリジンなので、毎回取り直しても実用上困らない。
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        // 画像として保存したものが別のMIMEとして解釈されないように
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
