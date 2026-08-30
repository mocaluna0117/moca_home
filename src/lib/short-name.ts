/**
 * カレンダーのマス目のような狭い場所に商品名を出すための短縮。
 *
 * ショップのタイトルは60〜140文字あり、141px 幅のセルには入らない。
 * core-name.ts が芯（「ペロリ」「ミートローフ」等）を 97.6% の精度で
 * 取り出せるので、それを使い、取れないときだけ先頭を切り詰める。
 */
import { findCoreName } from "./core-name";

/** 切り詰めたことを示す記号。全角1文字ぶんで済む。 */
const ELLIPSIS = "…";

/**
 * 表示用の短い名前。max は「見せたい最大文字数」で、超える場合のみ
 * 末尾を … に置き換える（結果は必ず max 文字以下になる）。
 */
export function shortLabel(name: string, max = 14): string {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const span = findCoreName(trimmed);
  const core = span ? trimmed.slice(span.start, span.end) : trimmed;

  if (core.length <= max) return core;
  // サロゲートペア（絵文字）の途中で切らない
  const cut = core.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  const safe = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return safe + ELLIPSIS;
}
