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
 * 登録できる「短い名前」の上限。
 *
 * **定数をここに置く理由**: 保存する Server Action（actions-product-names.ts）は
 * "use server" なので、非同期関数以外を export できない（ビルドが
 * "The module has no exports at all" で落ちる）。検証する側と入力欄の
 * maxLength が同じ値を見るために、両方が import できる純モジュールに置く。
 *
 * 20 はカレンダーのマス（10文字前後）の倍の余裕で、ホームや一覧のような
 * 広い場所でも切れずに出る長さ。
 */
export const MAX_SHORT_NAME = 20;

/**
 * 表示用の短い名前。max は「見せたい最大文字数」で、超える場合のみ
 * 末尾を … に置き換える（結果は必ず max 文字以下になる）。
 *
 * `registered` は商品に登録された短い名前（product_short_names）。
 * **あればそれが芯**で、推定より常に優先する — 推定は 97.6% で当たるが、
 * 外した日は名前が途中で切れる。飼い主が「ペロリ」と決めたなら、
 * どの画面でもそれを出す。切り詰めの規則は登録名にも同じように効く
 * （20文字まで登録できるので、10文字のマスでは「…」が付きうる）。
 */
export function shortLabel(
  name: string,
  max = 14,
  registered?: string | null,
): string {
  const chosen = registered?.trim();
  if (chosen) return truncate(chosen, max);

  const trimmed = name.trim();
  if (!trimmed) return "";

  const span = findCoreName(trimmed);
  const core = span ? trimmed.slice(span.start, span.end) : trimmed;

  return truncate(core, max);
}

/** max 文字以下に収める。サロゲートペア（絵文字）の途中では切らない */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  const safe = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return safe + ELLIPSIS;
}
