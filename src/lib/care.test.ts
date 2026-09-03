import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_ITEMS,
  careItemsErrorMessage,
  isTimeOfDay,
  parseYen,
  summarizeAmounts,
  validateCareItems,
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

describe("isTimeOfDay — <input type=time> の value と同形", () => {
  it("HH:MM の24時間表記だけを通す", () => {
    for (const ok of ["00:00", "09:30", "14:00", "23:59"]) {
      assert.equal(isTimeOfDay(ok), true, ok);
    }
    for (const bad of ["24:00", "9:30", "14:60", "14:00:00", "1400", "", null, 1400]) {
      assert.equal(isTimeOfDay(bad), false, String(bad));
    }
  });
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

  it("金額が空の行は「未確定」として通す（予約の記録）", () => {
    const r = validateCareItems([draft("シャンプーコース", ""), draft("カット", "  ")]);
    assert.deepEqual(r.ok && r.items, [
      { seq: 0, name: "シャンプーコース", amountYen: null },
      { seq: 1, name: "カット", amountYen: null },
    ]);
  });

  it("金額だけの行はエラー（何の金額か分からない記録を作らない）", () => {
    assert.deepEqual(validateCareItems([draft("", "6600")]), {
      ok: false,
      error: { kind: "no-name", seq: 0 },
    });
  });

  it("空欄ではないのに読めない金額はエラー（打ち間違いを未確定にしない）", () => {
    assert.deepEqual(validateCareItems([draft("シャンプー", "abc")]), {
      ok: false,
      error: { kind: "bad-amount", seq: 0 },
    });
  });

  it("1行も無くてもよい（予約だけ先に入れられる）", () => {
    assert.deepEqual(validateCareItems([]), { ok: true, items: [] });
    assert.deepEqual(validateCareItems([draft("", "")]), { ok: true, items: [] });
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
      "3行目の金額を数字で入力するか、空欄にしてください",
    );
  });
});

describe("summarizeAmounts — 合計は未確定の数と一緒に返す", () => {
  it("全部入っていれば合計そのまま。割引も含める", () => {
    assert.deepEqual(
      summarizeAmounts([{ amountYen: 6600 }, { amountYen: 1100 }, { amountYen: -500 }]),
      { totalYen: 7200, knownCount: 3, unknownCount: 0, pending: false },
    );
  });

  it("空欄の行があれば、入っている分の合計と未確定の数を返す", () => {
    assert.deepEqual(summarizeAmounts([{ amountYen: 6600 }, { amountYen: null }]), {
      totalYen: 6600,
      knownCount: 1,
      unknownCount: 1,
      pending: true,
    });
  });

  it("明細が無い・全部空欄なら合計0で未確定", () => {
    assert.deepEqual(summarizeAmounts([]), {
      totalYen: 0,
      knownCount: 0,
      unknownCount: 0,
      pending: true,
    });
    assert.equal(summarizeAmounts([{ amountYen: null }]).pending, true);
  });

  it("0円は「入っている」（未確定ではない）", () => {
    assert.deepEqual(summarizeAmounts([{ amountYen: 0 }]), {
      totalYen: 0,
      knownCount: 1,
      unknownCount: 0,
      pending: false,
    });
  });
});
