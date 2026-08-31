/**
 * Vercel Cron からの呼び出しだけを通すための検証。
 *
 * **middleware から import するので edge-safe に保つこと。**
 * このリポジトリの middleware は edge runtime でビルドされており
 * （.next/server/middleware-manifest.json の entrypoint が server/edge/...）、
 * node:crypto も Buffer も使えない。
 * 同じ理由で src/lib/auth.ts（先頭が import "server-only"）からも借りない。
 *
 * middleware の matcher からこのパスを除外してはいけない。除外すると
 * 「認証ゲートの外にあるURL」が増える。過去に拡張子の一括除外で
 * 未認証閲覧の穴が空いている。中で Bearer を検証して通す。
 */

/** cron が叩くパス。middleware と route の両方から参照する */
export const CRON_PATH = "/api/cron/heartworm";

/** 長さの違いは漏れるが、中身は1文字ずつ比べても早期に抜けない */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Authorization ヘッダが CRON_SECRET と一致するか。
 *
 * CRON_SECRET が未設定なら **常に false**。設定を忘れたときに
 * 誰でも叩けるエンドポイントになるより、cron が動かないほうがよい
 * （動かなければ画面の予定が消えないので気づける）。
 */
export function cronAuthMatches(
  header: string | null | undefined,
  secret: string | undefined | null,
): boolean {
  if (typeof secret !== "string" || secret.length < 16) return false;
  if (typeof header !== "string") return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  return safeEqual(header.slice(prefix.length), secret);
}
