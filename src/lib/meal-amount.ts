/**
 * ごはんの「分量」の純粋なロジック。
 *
 * DB も React も import しない（calendar.ts / care.ts と同じ立ち位置で、
 * tsx --test で単体実行できる）。
 *
 * **数値と単位に分ける。** 自由入力だった頃は「50g」「50ｇ」「50グラム」
 * 「大さじ1」が同じ列に混ざり、量として読み比べられなかった。数値は整数、
 * 単位は下の固定リストから選ぶ。どちらも null なら「入れていない」。
 *
 * **片方だけの行を作らない。** 「50」だけでは何の50か分からず、「g」だけでは
 * いくつか分からない。validateMealAmount がその2つを別々のエラーにする
 * （care.ts の validateCareItems と同じ作法で、画面に出す文もここが持つ）。
 */

/**
 * 選べる単位。**ここが唯一の正解**で、DB の列（meal_entries.amount_unit /
 * usual_meals.amount_unit）にはこの文字列がそのまま入る。
 *
 * 並びは選ぶ頻度の順（重さ → 容量 → 数えるもの）。増やすときはこの配列に
 * 足すだけでよく、画面のドロップダウンも保存側の検証も一緒に付いてくる。
 * 減らすときは、その単位で保存済みの行が読めなくなる（isMealAmountUnit が
 * false になる）ので、表示側は formatMealAmount 経由にしてある。
 */
export const MEAL_AMOUNT_UNITS = [
  "g",
  "ml",
  "個",
  "袋",
  "本",
  "枚",
  "粒",
  "缶",
] as const;

export type MealAmountUnit = (typeof MEAL_AMOUNT_UNITS)[number];

export function isMealAmountUnit(v: unknown): v is MealAmountUnit {
  return typeof v === "string" && (MEAL_AMOUNT_UNITS as readonly string[]).includes(v);
}

/**
 * 数量の上限。桁を打ち間違えたときの歯止め（care.ts の MAX_AMOUNT_YEN と
 * 同じ役目）。1回のごはんで 9999g を超えることはない。
 */
export const MAX_AMOUNT_VALUE = 9999;

export type MealAmountError =
  | "value-without-unit"
  | "unit-without-value"
  | "not-integer"
  | "out-of-range"
  | "invalid-unit";

export interface MealAmountInput {
  /** 画面から来る数値。空欄は null */
  amountValue: number | null;
  /** 画面から来る単位。未選択は null */
  amountUnit: string | null;
}

export interface MealAmountValue {
  amountValue: number | null;
  amountUnit: MealAmountUnit | null;
}

/**
 * 保存してよい形にする。両方 null（未入力）はそのまま通す —
 * 分量は必須ではない（おやつを1個あげた記録に量が要らない日がある）。
 */
export function validateMealAmount(
  input: MealAmountInput,
): { ok: true; value: MealAmountValue } | { ok: false; error: MealAmountError } {
  const { amountValue, amountUnit } = input;

  if (amountValue === null && amountUnit === null) {
    return { ok: true, value: { amountValue: null, amountUnit: null } };
  }
  if (amountValue !== null && amountUnit === null) {
    return { ok: false, error: "value-without-unit" };
  }
  if (amountValue === null && amountUnit !== null) {
    return { ok: false, error: "unit-without-value" };
  }
  if (!isMealAmountUnit(amountUnit)) return { ok: false, error: "invalid-unit" };
  if (typeof amountValue !== "number" || !Number.isFinite(amountValue)) {
    return { ok: false, error: "not-integer" };
  }
  if (!Number.isInteger(amountValue)) return { ok: false, error: "not-integer" };
  if (amountValue <= 0 || amountValue > MAX_AMOUNT_VALUE) {
    return { ok: false, error: "out-of-range" };
  }
  return { ok: true, value: { amountValue, amountUnit } };
}

export function mealAmountErrorMessage(error: MealAmountError): string {
  switch (error) {
    case "value-without-unit":
      return "分量の単位を選んでください";
    case "unit-without-value":
      return "分量の数値を入力してください";
    case "not-integer":
      return "分量は整数で入力してください";
    case "out-of-range":
      return `分量は1〜${MAX_AMOUNT_VALUE}で入力してください`;
    case "invalid-unit":
      return "分量の単位が不正です";
  }
}

/**
 * 表示用の1語（"50g"）。
 *
 * 数値と単位があればそれを組み立て、無ければ**昔の自由入力**を返す。
 * 分ける前に入れた記録（"50g" / "少なめ"）が読めなくならないための道で、
 * 表示は必ずここを通す（列を直接読むと、古い記録だけ分量が消える画面ができる）。
 */
export function formatMealAmount(row: {
  amountValue: number | null;
  amountUnit: string | null;
  amount: string | null;
}): string | null {
  if (row.amountValue !== null && isMealAmountUnit(row.amountUnit)) {
    return `${row.amountValue}${row.amountUnit}`;
  }
  const legacy = row.amount?.trim();
  return legacy ? legacy : null;
}
