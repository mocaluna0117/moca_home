/**
 * トリミング・通院の明細まわりの純粋なロジック。
 *
 * 金額は整数の円（float を使わない）。割引は負の金額の明細行で表す。
 * 合計は必ず明細から計算する（DBに合計の列を持たない）。
 */

/** 1回の来店で入れられる明細の上限 */
export const MAX_ITEMS = 30;
/** 1行の金額の上限（絶対値）。桁を打ち間違えたときの歯止め */
export const MAX_AMOUNT_YEN = 10_000_000;
export const MAX_NAME_LENGTH = 100;

/**
 * 「6,600」「¥6,600」「6600円」「△500」を整数の円にする。
 *
 * 領収書の書き写しなので表記ゆれが大きい。読めなければ null を返し、
 * 呼び出し側が「入力し直してください」と言えるようにする（0 にしない）。
 */
export function parseYen(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && Math.abs(raw) <= MAX_AMOUNT_YEN ? raw : null;
  }
  if (typeof raw !== "string") return null;

  let text = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥,，、\s円]/g, "")
    .trim();
  if (text === "") return null;

  // 会計書類で使われるマイナス表記
  let negative = false;
  if (/^[-−ー－△▲]/.test(text)) {
    negative = true;
    text = text.slice(1);
  }
  if (!/^\d+$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > MAX_AMOUNT_YEN) return null;
  return negative ? -value : value;
}

export interface CareItemDraft {
  name: string;
  /** 画面から来る生の文字列。parseYen に通す */
  amount: string;
}

export interface CareItemValue {
  seq: number;
  name: string;
  amountYen: number;
}

export type CareItemsError =
  | { kind: "empty" }
  | { kind: "too-many" }
  | { kind: "no-name"; seq: number }
  | { kind: "long-name"; seq: number }
  | { kind: "bad-amount"; seq: number };

/**
 * 画面の明細行を、DBに入れてよい形にする。
 *
 * 名前も金額も空の行は「まだ書いていない行」として黙って捨てる
 * （行を足したまま保存する操作が普通に起きるため）。
 * 片方だけ埋まっている行はエラーにする（打ち忘れを見逃さない）。
 */
export function validateCareItems(
  drafts: readonly CareItemDraft[],
): { ok: true; items: CareItemValue[] } | { ok: false; error: CareItemsError } {
  const filled = drafts.filter(
    (d) => d.name.trim() !== "" || d.amount.trim() !== "",
  );
  if (filled.length === 0) return { ok: false, error: { kind: "empty" } };
  if (filled.length > MAX_ITEMS) return { ok: false, error: { kind: "too-many" } };

  const items: CareItemValue[] = [];
  for (const [i, d] of filled.entries()) {
    const name = d.name.trim();
    if (name === "") return { ok: false, error: { kind: "no-name", seq: i } };
    if (name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: { kind: "long-name", seq: i } };
    }
    const amountYen = parseYen(d.amount);
    if (amountYen === null) return { ok: false, error: { kind: "bad-amount", seq: i } };
    items.push({ seq: i, name, amountYen });
  }
  return { ok: true, items };
}

export function careItemsErrorMessage(error: CareItemsError): string {
  switch (error.kind) {
    case "empty":
      return "明細を1行以上入力してください";
    case "too-many":
      return `明細は${MAX_ITEMS}行までです`;
    case "no-name":
      return `${error.seq + 1}行目の品目名を入力してください`;
    case "long-name":
      return `${error.seq + 1}行目の品目名は${MAX_NAME_LENGTH}文字以内で入力してください`;
    case "bad-amount":
      return `${error.seq + 1}行目の金額を数字で入力してください`;
  }
}

/** 合計は常にここで計算する。DBに合計の列を持たない */
export function totalYen(items: readonly { amountYen: number }[]): number {
  return items.reduce((sum, i) => sum + i.amountYen, 0);
}
