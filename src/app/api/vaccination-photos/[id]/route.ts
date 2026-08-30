import { NextResponse } from "next/server";

import { isBlobConfigured } from "@/lib/blob";
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
  const photoId = Number.parseInt(id, 10);
  if (!Number.isInteger(photoId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const photo = await getVaccinationPhoto(photoId);
  if (!photo) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!isBlobConfigured()) {
    return NextResponse.json({ error: "写真の保存先が未設定です" }, { status: 404 });
  }

  try {
    const { head } = await import("@vercel/blob");
    // private ストアでは downloadUrl に短命の署名が付く
    const meta = await head(photo.url);
    const upstream = await fetch(meta.downloadUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": photo.contentType ?? meta.contentType ?? "image/jpeg",
        // 認証の内側なので共有キャッシュには載せない
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
