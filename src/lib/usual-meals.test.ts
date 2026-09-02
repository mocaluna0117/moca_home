import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MealSlot } from "./calendar";
import {
  USUAL_SLOTS,
  groupUsualBySlot,
  isUsualSlot,
  planUsualApply,
  type UsualItem,
} from "./usual-meals";

const item = (
  slot: MealSlot,
  label: string,
  extra: Partial<UsualItem> = {},
): UsualItem => ({ slot, productId: null, label, amount: null, note: null, ...extra });

/** slot にゴミが入った行（DB を直接いじった・後から値が増えた場合） */
const junkSlot = (slot: string, label: string): UsualItem => ({
  ...item("morning", label),
  slot: slot as unknown as MealSlot,
});

/** 比較用。適用計画を「スロット: 品目名, 品目名」の配列に畳む */
const shape = (plan: ReturnType<typeof planUsualApply>): string[] =>
  plan.map((p) => `${p.slot}: ${p.items.map((i) => i.label).join(", ")}`);

const labels = (items: readonly UsualItem[]): string[] => items.map((i) => i.label);

describe("isUsualSlot — 朝と夜だけを通す", () => {
  it("morning と evening を受ける", () => {
    assert.equal(isUsualSlot("morning"), true);
    assert.equal(isUsualSlot("evening"), true);
    // USUAL_SLOTS の全要素が通ること（配列を増やしたら判定も増える）
    for (const slot of USUAL_SLOTS) assert.equal(isUsualSlot(slot), true);
  });
  it("treat は MealSlot だが通さない（この機能はおやつを扱わない）", () => {
    assert.equal(isUsualSlot("treat"), false);
  });
  it("空文字・null・undefined・数値・オブジェクトを弾く", () => {
    assert.equal(isUsualSlot(""), false);
    assert.equal(isUsualSlot(null), false);
    assert.equal(isUsualSlot(undefined), false);
    assert.equal(isUsualSlot(0), false);
    assert.equal(isUsualSlot(1), false);
    assert.equal(isUsualSlot(NaN), false);
    assert.equal(isUsualSlot({}), false);
    assert.equal(isUsualSlot(["morning"]), false);
  });
  it("大文字・別名は通さない（文字列の完全一致）", () => {
    assert.equal(isUsualSlot("Morning"), false);
    assert.equal(isUsualSlot("MORNING"), false);
    assert.equal(isUsualSlot("breakfast"), false);
    assert.equal(isUsualSlot(" morning"), false);
  });
});

describe("groupUsualBySlot — 両方のキーが必ずある", () => {
  it("登録が空でも morning / evening が [] で返る", () => {
    const grouped = groupUsualBySlot([]);
    assert.deepEqual(Object.keys(grouped).sort(), ["evening", "morning"]);
    assert.deepEqual(grouped.morning, []);
    assert.deepEqual(grouped.evening, []);
  });

  it("朝だけ登録されていても夜のキーは [] で存在する", () => {
    const grouped = groupUsualBySlot([item("morning", "ドライフード")]);
    assert.deepEqual(labels(grouped.morning), ["ドライフード"]);
    assert.deepEqual(grouped.evening, []);
  });

  it("夜だけ登録されていても朝のキーは [] で存在する", () => {
    const grouped = groupUsualBySlot([item("evening", "ささみ")]);
    assert.deepEqual(grouped.morning, []);
    assert.deepEqual(labels(grouped.evening), ["ささみ"]);
  });

  it("スロット内は入力順（= seq 順）のまま", () => {
    const grouped = groupUsualBySlot([
      item("morning", "1品目"),
      item("morning", "2品目"),
      item("morning", "3品目"),
    ]);
    assert.deepEqual(labels(grouped.morning), ["1品目", "2品目", "3品目"]);
  });

  it("treat やゴミの slot は捨てる", () => {
    const grouped = groupUsualBySlot([
      item("treat", "ジャーキー"),
      item("morning", "ドライフード"),
      junkSlot("", "空スロット"),
      junkSlot("lunch", "昼ごはん"),
      junkSlot("Morning", "大文字"),
    ]);
    assert.deepEqual(labels(grouped.morning), ["ドライフード"]);
    assert.deepEqual(grouped.evening, []);
  });

  it("分量とメモはそのまま持ち越す（値を作り直さない）", () => {
    const row = item("evening", "ドライフード", {
      productId: 12,
      amount: "50g",
      note: "半分に折る",
    });
    const grouped = groupUsualBySlot([row]);
    assert.deepEqual(grouped.evening, [row]);
  });
});

describe("planUsualApply — 0件のスロットは落とし、常に朝 → 夜", () => {
  it("登録が空なら適用対象は無い（オフの状態）", () => {
    assert.deepEqual(planUsualApply([]), []);
  });

  it("朝だけ登録 → 朝の1件だけ（夜は 0件なので含めない）", () => {
    const plan = planUsualApply([
      item("morning", "ドライフード", { amount: "50g" }),
      item("morning", "ささみ"),
    ]);
    assert.deepEqual(shape(plan), ["morning: ドライフード, ささみ"]);
  });

  it("夜だけ登録 → 夜の1件だけ", () => {
    const plan = planUsualApply([item("evening", "ウェットフード")]);
    assert.deepEqual(shape(plan), ["evening: ウェットフード"]);
  });

  it("両方登録 → 朝 → 夜の2件", () => {
    const plan = planUsualApply([
      item("morning", "朝のごはん"),
      item("evening", "夜のごはん"),
    ]);
    assert.deepEqual(shape(plan), ["morning: 朝のごはん", "evening: 夜のごはん"]);
  });

  it("入力が夜から並んでいても順序は朝 → 夜", () => {
    const plan = planUsualApply([
      item("evening", "夜1"),
      item("morning", "朝1"),
      item("evening", "夜2"),
      item("morning", "朝2"),
    ]);
    assert.deepEqual(shape(plan), ["morning: 朝1, 朝2", "evening: 夜1, 夜2"]);
    assert.deepEqual(
      plan.map((p) => p.slot),
      ["morning", "evening"],
    );
  });

  it("スロット内の順序は入力順のまま（並べ替えない）", () => {
    const plan = planUsualApply([
      item("morning", "さいご"),
      item("morning", "あとから"),
      item("morning", "はじめ"),
    ]);
    assert.deepEqual(shape(plan), ["morning: さいご, あとから, はじめ"]);
  });

  it("treat が混ざっていても適用対象にならない", () => {
    const plan = planUsualApply([
      item("treat", "ジャーキー"),
      item("morning", "ドライフード"),
      item("treat", "ボーロ"),
    ]);
    assert.deepEqual(shape(plan), ["morning: ドライフード"]);
  });

  it("treat だけ登録されていたら適用対象は無い（0件のスロットは落ちる）", () => {
    assert.deepEqual(planUsualApply([item("treat", "ジャーキー")]), []);
  });

  it("壊れた slot だけなら何も適用しない", () => {
    assert.deepEqual(planUsualApply([junkSlot("lunch", "昼ごはん")]), []);
  });

  it("品目は登録の行そのまま（分量・メモ・productId を落とさない）", () => {
    const row = item("morning", "ドライフード", {
      productId: 7,
      amount: "50g",
      note: "ふやかす",
    });
    const plan = planUsualApply([row]);
    assert.equal(plan.length, 1);
    assert.deepEqual(plan[0].items, [row]);
  });

  it("入力を書き換えない（呼び出し側の配列は無傷）", () => {
    const items = [item("evening", "夜"), item("morning", "朝")];
    const before = labels(items);
    planUsualApply(items);
    assert.deepEqual(labels(items), before);
  });
});
