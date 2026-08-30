/**
 * URL の動的セグメントを数値IDとして受け取るときの検証。
 *
 * Number.parseInt() を使ってはいけない。"12.jpg" も "12abc" も " 12" も 12 に
 * なるため、拡張子を付けたURLがハンドラ本体に到達する。middleware の matcher が
 * 拡張子で終わるパスを認証ゲートから外していた時期があり、この2つが噛み合って
 * 未認証で /api/vaccination-photos/1.jpg が読めていた（実証済み・修正済み）。
 *
 * 桁数の上限は SQLite の INTEGER と、総当たりURLの長さを抑えるため。
 */
export function parseIdParam(raw: string | undefined | null): number | null {
  if (typeof raw !== "string") return null;
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  return Number(raw);
}
