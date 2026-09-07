import "server-only";

import { createHash } from "node:crypto";

/**
 * 写真の応答に付ける ETag。
 *
 * 種は Blob の pathname。アップロードのたびに crypto.randomUUID() ＋
 * addRandomSuffix で必ず新しい値になるので、pathname が変わっていない＝
 * 中身が変わっていない、が成り立つ。
 *
 * **pathname をそのまま出さない**。あれは Blob の削除キーで、
 * schema.ts が「削除キー＝表示経路の鍵」と書いている値。ハッシュにすれば
 * 同一性の判定だけができて、鍵はブラウザに渡らない。
 *
 * 返すのは強い ETag（W/ を付けない）。バイト列が同じであることを
 * 主張しているので、304 の判定に使ってよい。
 */
export function photoEtag(pathname: string): string {
  return `"${createHash("sha256").update(pathname).digest("base64url").slice(0, 22)}"`;
}

/**
 * 写真の応答に共通のヘッダー。
 *
 * **no-store ではなく no-cache。** no-store は「保存するな」なので毎回
 * 全部を送り直すことになり、ページを開くたびに 150〜300KB が飛んでいた。
 * no-cache は「保存してよいが、使う前に必ずサーバへ確認しろ」。確認は
 * middleware の認証ゲートの内側なので、ログアウト後に URL を直接開いても
 * 401 で弾かれ、端末のキャッシュは使われない — 共有端末に対する元の方針
 * （dog-photo/route.ts のコメント）はそのまま守られる。
 */
export function photoHeaders(contentType: string, etag: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-cache",
    ETag: etag,
    // 画像として保存したものが別のMIMEとして解釈されないように
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
}

/** If-None-Match が一致するか。`*` と、カンマ区切りの複数指定に対応する */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  return ifNoneMatch
    .split(",")
    .map((v) => v.trim().replace(/^W\//, ""))
    .includes(etag);
}
