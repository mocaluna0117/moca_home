import { NextResponse } from "next/server";

import { isBlobConfigured } from "@/lib/blob";
import { getDogPhoto } from "@/lib/queries-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * もかの写真を1枚だけ返す。private な Blob は直リンクで開けないので、
 * 同一オリジンのこのルートが取得して返す（/api/vaccination-photos/[id] と
 * 同じ形・同じヘッダー）。middleware の認証ゲートの内側にある。
 *
 * **動的セグメントを持たない。** 行は常に1つなので id を受け取る必要がなく、
 * 受け取らなければ "1.jpg" のような値がハンドラ本体に届く経路そのものが
 * 存在しない（src/lib/route-params.ts のコメントにある過去の穴と同じ形を
 * 作れない）。middleware.ts の matcher にも当然何も足さない。
 *
 * `?v=` は photoVersion のキャッシュ破りだけのための引数なので、
 * 引数として受け取らない = 読み捨てる。返す実体は常に「今の1枚」。
 *
 * **どの失敗も 404 の JSON で返し、throw しない。** ヒーローの <img> は
 * onError で破線の丸に落ちるので、500 を投げても得るものが無い。
 */
export async function GET() {
  try {
    const photo = await getDogPhoto();
    if (!photo?.pathname) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // ローカル既定はトークン未設定。ここで 500 を返すと「写真をまだ
    // 付けていない」のと同じ状態が障害に見える
    if (!isBlobConfigured()) {
      return NextResponse.json({ error: "写真の保存先が未設定です" }, { status: 404 });
    }

    const { get } = await import("@vercel/blob");
    // private ストアの読み出しはトークンが要る。get() がそれを担う。
    const result = await get(photo.pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": photo.contentType ?? result.blob.contentType ?? "image/jpeg",
        // 家族と共有する端末で、ログアウト後に直接URLを開いたときに
        // ブラウザキャッシュから配信されてしまわないようにする。
        // 縮小後 150〜300KB・同一オリジンなので、毎回取り直しても実用上困らない。
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
