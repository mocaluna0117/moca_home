import { NextResponse } from "next/server";

import { isBlobConfigured } from "@/lib/blob";
import { etagMatches, photoEtag, photoHeaders } from "@/lib/photo-etag";
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
 * **ETag を付けて、変わっていなければ本体を送らない。** 以前は no-store で
 * 毎回 150〜300KB を送り直していた（ページを開くたびに DB 1往復 ＋ Blob 1往復
 * ＋ 全バイト）。いまは pathname から作った ETag が一致すれば 304 を返し、
 * **Blob へ取りに行きもしない**。安全性は変わらない — no-cache なので
 * ブラウザは使う前に必ずここへ確認しに来て、ログアウト後は middleware が
 * 401 で弾く（キャッシュの中身は表に出ない）。
 *
 * **どの失敗も 404 の JSON で返し、throw しない。** ヒーローの <img> は
 * onError で破線の丸に落ちるので、500 を投げても得るものが無い。
 */
export async function GET(request: Request) {
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

    // 変わっていなければここで終わり。Blob への往復も本体の転送も起きない
    const etag = photoEtag(photo.pathname);
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: photoHeaders(photo.contentType ?? "image/jpeg", etag),
      });
    }

    const { get } = await import("@vercel/blob");
    // private ストアの読み出しはトークンが要る。get() がそれを担う。
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
