/**
 * トリミング・通院の明細まわりの純粋なロジック。
 *
 * 金額は整数の円（float を使わない）。割引は負の金額の明細行で表す。
 * 合計は必ず明細から計算する（DBに合計の列を持たない）。
 *
 * **金額は空欄でよい。** トリミングは予約の時点で記録するので、コースは
 * 決まっていても金額がまだ確定していないことが普通にある。空欄は null
 * （「分からない」）で、0（「0円」）とは別物。null を落として合計すると
 * 過少申告になるので、合計は常に「金額の入っていない行の数」と一緒に
 * 返す（summarizeAmounts）。合計だけを返す関数は置かない。
 */

/** 1回の来店で入れられる明細の上限 */
export const MAX_ITEMS = 30;
/** 1行の金額の上限（絶対値）。桁を打ち間違えたときの歯止め */
export const MAX_AMOUNT_YEN = 10_000_000;
export const MAX_NAME_LENGTH = 100;
/** お店・病院の名前の上限。自由入力の place と登録（care_places）で共通 */
export const MAX_PLACE_NAME = 100;
/** コース名の上限 */
export const MAX_COURSE_NAME = 100;

/**
 * 「6,600」「¥6,600」「6600円」「△500」を整数の円にする。
 *
 * 領収書の書き写しなので表記ゆれが大きい。読めなければ null を返し、
 * 呼び出し側が「入力し直してください」と言えるようにする（0 にしない）。
 * **空文字も null**。空欄（未確定）と読めない文字列の区別は、呼び出し側が
 * trim() === "" を先に見て付ける（validateCareItems がそうしている）。
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

/**
 * 予約の時間 "HH:MM"（24時間）。<input type="time"> の value と同形で、
 * 秒は持たない（ブラウザが "HH:MM:SS" を返す設定にはしていない。来たら
 * 呼び出し側が先頭5文字に切ってからここに通す）。
 */
export function isTimeOfDay(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export interface CareItemDraft {
  name: string;
  /** 画面から来る生の文字列。空なら「未確定」、それ以外は parseYen に通す */
  amount: string;
}

export interface CareItemValue {
  seq: number;
  name: string;
  /** null = 金額未確定 */
  amountYen: number | null;
}

export type CareItemsError =
  | { kind: "too-many" }
  | { kind: "no-name"; seq: number }
  | { kind: "long-name"; seq: number }
  | { kind: "bad-amount"; seq: number };

/**
 * 画面の明細行を、DBに入れてよい形にする。
 *
 * - 名前も金額も空の行は「まだ書いていない行」として黙って捨てる
 *   （行を足したまま保存する操作が普通に起きるため）
 * - 名前があって金額が空の行は **金額未確定** として通す（予約の記録）
 * - 金額があって名前が無い行はエラー（何の金額か分からない記録を作らない）
 * - 金額が空ではないのに数字として読めない行はエラー（打ち間違いを見逃さない）
 * - 明細が1行も無くてもよい。予約だけ先に入れて、コースはあとから足せる
 */
export function validateCareItems(
  drafts: readonly CareItemDraft[],
): { ok: true; items: CareItemValue[] } | { ok: false; error: CareItemsError } {
  const filled = drafts.filter(
    (d) => d.name.trim() !== "" || d.amount.trim() !== "",
  );
  if (filled.length > MAX_ITEMS) return { ok: false, error: { kind: "too-many" } };

  const items: CareItemValue[] = [];
  for (const [i, d] of filled.entries()) {
    const name = d.name.trim();
    if (name === "") return { ok: false, error: { kind: "no-name", seq: i } };
    if (name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: { kind: "long-name", seq: i } };
    }
    let amountYen: number | null = null;
    if (d.amount.trim() !== "") {
      amountYen = parseYen(d.amount);
      if (amountYen === null) return { ok: false, error: { kind: "bad-amount", seq: i } };
    }
    items.push({ seq: i, name, amountYen });
  }
  return { ok: true, items };
}

export function careItemsErrorMessage(error: CareItemsError): string {
  switch (error.kind) {
    case "too-many":
      return `明細は${MAX_ITEMS}行までです`;
    case "no-name":
      return `${error.seq + 1}行目の品目名を入力してください`;
    case "long-name":
      return `${error.seq + 1}行目の品目名は${MAX_NAME_LENGTH}文字以内で入力してください`;
    case "bad-amount":
      return `${error.seq + 1}行目の金額を数字で入力するか、空欄にしてください`;
  }
}

export interface AmountSummary {
  /** 金額の入っている明細の合計。未確定の行は含まない（＝下限） */
  totalYen: number;
  /** 金額の入っている明細の数 */
  knownCount: number;
  /** 金額が空欄の明細の数 */
  unknownCount: number;
  /**
   * 合計をそのまま「かかった金額」と読んではいけないか。
   * 空欄の行があるか、明細が1行も無い（＝いくらか分からない）とき true。
   * 表示側はこれで「未確定」の札を出す。
   */
  pending: boolean;
}

/** 合計は常にここで計算する。DBに合計の列を持たない */
export function summarizeAmounts(
  items: readonly { amountYen: number | null }[],
): AmountSummary {
  let totalYen = 0;
  let knownCount = 0;
  let unknownCount = 0;
  for (const it of items) {
    if (it.amountYen === null) unknownCount++;
    else {
      totalYen += it.amountYen;
      knownCount++;
    }
  }
  return { totalYen, knownCount, unknownCount, pending: unknownCount > 0 || knownCount === 0 };
}
