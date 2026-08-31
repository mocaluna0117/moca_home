import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_ITEMS,
  parseYen,
  totalYen,
  validateCareItems,
  careItemsErrorMessage,
} from "./care";

describe("parseYen — 領収書の書き写しに耐える", () => {
  const cases: Array<[unknown, number | null]> = [
    ["6600", 6600],
    ["6,600", 6600],
    ["¥6,600", 6600],
    ["￥6,600", 6600],
    ["6600円", 6600],
    ["６６００", 6600],
    ["　6,600 ", 6600],
    ["0", 0],
    ["-500", -500],
    ["△500", -500],
    ["▲500", -500],
    ["−500", -500],
    [6600, 6600],
    ["", null],
    ["   ", null],
    ["abc", null],
    ["1,10a0", null],
    ["1.5", null],
    ["6600.00", null],
    [1.5, null],
    [null, null],
    [undefined, null],
    ["99999999999", null],
  ];
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input)} → ${want}`, () => assert.equal(parseYen(input), want));
  }
});

const draft = (name: string, amount: string) => ({ name, amount });

describe("validateCareItems", () => {
  it("ふつうの明細を通す", () => {
    const r = validateCareItems([
      draft("シャンプーコース", "6,600"),
      draft("肉球ケア", "1,100"),
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.items, [
      { seq: 0, name: "シャンプーコース", amountYen: 6600 },
      { seq: 1, name: "肉球ケア", amountYen: 1100 },
    ]);
  });

  it("名前も金額も空の行は黙って捨てる（行を足したまま保存されるため）", () => {
    const r = validateCareItems([
      draft("シャンプー", "6600"),
      draft("", ""),
      draft("  ", "  "),
    ]);
    assert.equal(r.ok && r.items.length, 1);
  });

  it("片方だけ埋まっている行はエラーにする（打ち忘れを見逃さない）", () => {
    assert.deepEqual(validateCareItems([draft("シャンプー", "")]), {
      ok: false,
      error: { kind: "bad-amount", seq: 0 },
    });
    assert.deepEqual(validateCareItems([draft("", "6600")]), {
      ok: false,
      error: { kind: "no-name", seq: 0 },
    });
  });

  it("1行も無ければエラー", () => {
    assert.deepEqual(validateCareItems([]), { ok: false, error: { kind: "empty" } });
    assert.deepEqual(validateCareItems([draft("", "")]), {
      ok: false,
      error: { kind: "empty" },
    });
  });

  it("多すぎる明細を弾く", () => {
    const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => draft(`品目${i}`, "100"));
    assert.deepEqual(validateCareItems(many), { ok: false, error: { kind: "too-many" } });
  });

  it("長すぎる品目名を弾く", () => {
    assert.deepEqual(validateCareItems([draft("あ".repeat(101), "100")]), {
      ok: false,
      error: { kind: "long-name", seq: 0 },
    });
  });

  it("割引の行を通す", () => {
    const r = validateCareItems([draft("コース", "6600"), draft("初回割引", "△500")]);
    assert.deepEqual(r.ok && r.items[1], { seq: 1, name: "初回割引", amountYen: -500 });
  });

  it("エラー文が行番号を1始まりで指す", () => {
    assert.equal(
      careItemsErrorMessage({ kind: "bad-amount", seq: 2 }),
      "3行目の金額を数字で入力してください",
    );
  });
});

describe("totalYen", () => {
  it("割引を含めて合計する", () => {
    assert.equal(totalYen([{ amountYen: 6600 }, { amountYen: 1100 }, { amountYen: -500 }]), 7200);
  });
  it("空なら0", () => assert.equal(totalYen([]), 0));
});
