import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_AMOUNT_VALUE,
  MEAL_AMOUNT_UNITS,
  formatMealAmount,
  isMealAmountUnit,
  mealAmountErrorMessage,
  validateMealAmount,
} from "./meal-amount";

describe("isMealAmountUnit", () => {
  it("リストにある単位だけを通す", () => {
    for (const u of MEAL_AMOUNT_UNITS) assert.equal(isMealAmountUnit(u), true, u);
    for (const bad of ["グラム", "ｇ", "kg", "", null, undefined, 1]) {
      assert.equal(isMealAmountUnit(bad), false, String(bad));
    }
  });
});

const input = (amountValue: number | null, amountUnit: string | null) => ({
  amountValue,
  amountUnit,
});

describe("validateMealAmount", () => {
  it("数値と単位がそろえば通す", () => {
    assert.deepEqual(validateMealAmount(input(50, "g")), {
      ok: true,
      value: { amountValue: 50, amountUnit: "g" },
    });
  });

  it("どちらも空なら通す（分量は必須ではない）", () => {
    assert.deepEqual(validateMealAmount(input(null, null)), {
      ok: true,
      value: { amountValue: null, amountUnit: null },
    });
  });

  it("片方だけの行はエラー（何の50か・いくつかが分からない）", () => {
    assert.deepEqual(validateMealAmount(input(50, null)), {
      ok: false,
      error: "value-without-unit",
    });
    assert.deepEqual(validateMealAmount(input(null, "g")), {
      ok: false,
      error: "unit-without-value",
    });
  });

  it("リストに無い単位を弾く（画面から来た文字列を信用しない）", () => {
    assert.deepEqual(validateMealAmount(input(50, "グラム")), {
      ok: false,
      error: "invalid-unit",
    });
  });

  it("整数以外を弾く", () => {
    assert.deepEqual(validateMealAmount(input(1.5, "g")), {
      ok: false,
      error: "not-integer",
    });
    assert.deepEqual(validateMealAmount(input(Number.NaN, "g")), {
      ok: false,
      error: "not-integer",
    });
  });

  it("0以下と上限超えを弾く", () => {
    assert.deepEqual(validateMealAmount(input(0, "g")), {
      ok: false,
      error: "out-of-range",
    });
    assert.deepEqual(validateMealAmount(input(-1, "g")), {
      ok: false,
      error: "out-of-range",
    });
    assert.deepEqual(validateMealAmount(input(MAX_AMOUNT_VALUE + 1, "g")), {
      ok: false,
      error: "out-of-range",
    });
    assert.equal(validateMealAmount(input(MAX_AMOUNT_VALUE, "g")).ok, true);
  });

  it("エラー文が何を直せばよいか言う", () => {
    assert.equal(mealAmountErrorMessage("value-without-unit"), "分量の単位を選んでください");
    assert.equal(mealAmountErrorMessage("unit-without-value"), "分量の数値を入力してください");
    assert.equal(
      mealAmountErrorMessage("out-of-range"),
      `分量は1〜${MAX_AMOUNT_VALUE}で入力してください`,
    );
  });
});

describe("formatMealAmount — 古い自由入力も読めること", () => {
  it("数値と単位があればそれを組み立てる", () => {
    assert.equal(
      formatMealAmount({ amountValue: 50, amountUnit: "g", amount: null }),
      "50g",
    );
  });

  it("新しい値があれば、昔の自由入力より優先する", () => {
    assert.equal(
      formatMealAmount({ amountValue: 60, amountUnit: "g", amount: "50g" }),
      "60g",
    );
  });

  it("新しい値が無ければ昔の自由入力を返す（分ける前の記録）", () => {
    assert.equal(
      formatMealAmount({ amountValue: null, amountUnit: null, amount: "少なめ" }),
      "少なめ",
    );
  });

  it("壊れた単位の行は昔の自由入力に落ちる（単位を減らした場合の保険）", () => {
    assert.equal(
      formatMealAmount({ amountValue: 50, amountUnit: "合", amount: "50合" }),
      "50合",
    );
    assert.equal(
      formatMealAmount({ amountValue: 50, amountUnit: "合", amount: null }),
      null,
    );
  });

  it("どちらも無ければ null（空の行を描かせない）", () => {
    assert.equal(formatMealAmount({ amountValue: null, amountUnit: null, amount: null }), null);
    assert.equal(formatMealAmount({ amountValue: null, amountUnit: null, amount: "  " }), null);
  });
});
