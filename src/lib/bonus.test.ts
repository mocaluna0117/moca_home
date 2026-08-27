import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeOrderBonuses,
  parseBonusRule,
  parseBonusRules,
} from "./bonus";

// Titles below are verbatim (possibly shortened) snapshots from the real DB.

describe("parseBonusRule — A: same-product bonus", () => {
  it("basic 「2コご注文で＋1コプレゼント」", () => {
    const r = parseBonusRule("大人気！2コご注文で＋1コプレゼント♡美容ふりかけ素");
    assert.equal(r?.kind, "same-plus");
    assert.equal(r.kind === "same-plus" && r.threshold, 2);
    assert.equal(r.kind === "same-plus" && r.bonusCount, 1);
  });

  it("「2コで＋1コプレゼント」(ご注文なし) と 「3コご注文で＋1コのプレゼント」(の)", () => {
    assert.equal(parseBonusRule("大人気！2コで＋1コプレゼント♡")?.kind, "same-plus");
    const r = parseBonusRule("ペロリ♪3コご注文で＋1コのプレゼント♡");
    assert.equal(r?.kind, "same-plus");
    assert.equal(r.kind === "same-plus" && r.threshold, 3);
  });

  it("全角数字・合計・companion スコープ", () => {
    const r = parseBonusRule(
      "ペロリ♪合計３コご注文で＋１コプレゼント♡30種ふりかけと合わせてもOK！",
    );
    assert.equal(r?.kind, "same-plus");
    if (r?.kind !== "same-plus") return;
    assert.equal(r.threshold, 3);
    assert.equal(r.bonusCount, 1);
    assert.deepEqual(r.scope, {
      type: "companion",
      family: "ふりかけ",
      alias: "30種ふりかけ",
    });
  });

  it("「どのふりかけでも」→ category スコープ、「どの納豆ふりかけでも」は狭い方", () => {
    const broad = parseBonusRule("どのふりかけでも3コご注文で＋1コプレゼント！");
    assert.deepEqual(broad?.scope, { type: "category", family: "ふりかけ" });
    const narrow = parseBonusRule(
      "どの納豆ふりかけでも3コご注文で＋1コプレゼント！",
    );
    assert.deepEqual(narrow?.scope, { type: "category", family: "納豆ふりかけ" });
  });

  it("複合「＋1コとおやつ6袋プレゼント」", () => {
    const r = parseBonusRule(
      "1コごとにおやつ3つ同封♪【本日2コご注文で＋1コとおやつ6袋プレゼント♡】『美容ふりかけ素』",
    );
    assert.equal(r?.kind, "same-plus");
    if (r?.kind !== "same-plus") return;
    assert.equal(r.threshold, 2);
    assert.deepEqual(r.extraGifts, [{ label: "おやつ", count: 6, unit: "袋" }]);
  });

  it("連結「＋1コプレゼント＋カモさんジャーキープレゼント！」", () => {
    const r = parseBonusRule(
      "本日限定♡2コご注文で＋1コプレゼント＋カモさんジャーキープレゼント！『美容ふりかけ素』",
    );
    assert.equal(r?.kind, "same-plus");
    if (r?.kind !== "same-plus") return;
    assert.deepEqual(r.extraGifts, [
      { label: "カモさんジャーキー", count: null, unit: null },
    ]);
  });

  it("matchedText は元文字列のスライス", () => {
    const name = "ペロリ♪合計３コご注文で＋１コプレゼント♡";
    const r = parseBonusRule(name);
    assert.ok(r && name.includes(r.matchedText));
    assert.ok(r?.matchedText.includes("３コ"));
  });
});

describe("parseBonusRule — B: different-item gift", () => {
  it("「3セットご注文で手作りご飯(2040円)プレゼント」+ typo「ご注文で注文で」", () => {
    const r = parseBonusRule(
      "静岡県産若鶏＋北海道産鹿肉の心臓サポート！3セットご注文で注文で手作りご飯(2040円)プレゼント！",
    );
    assert.equal(r?.kind, "gift");
    if (r?.kind !== "gift") return;
    assert.equal(r.threshold, 3);
    assert.equal(r.gift.label, "手作りご飯");
    assert.equal(r.gift.valueYen, 2040);
  });

  it("「2040円〜1セットプレゼント」+ どのミートローフでも", () => {
    const r = parseBonusRule(
      "どのミートローフでも3セットご注文で手作りご飯2040円〜1セットプレゼント♡",
    );
    assert.equal(r?.kind, "gift");
    if (r?.kind !== "gift") return;
    assert.equal(r.gift.count, 1);
    assert.equal(r.gift.approx, true);
    assert.deepEqual(r.scope, { type: "category", family: "ミートローフ" });
  });

  it("「1セット (2040円)分プレゼント」語順", () => {
    const r = parseBonusRule(
      "どのミートローフ3セットご注文で手作りご飯1セット (2040円)分プレゼント♡",
    );
    assert.equal(r?.kind, "gift");
    if (r?.kind !== "gift") return;
    assert.equal(r.gift.count, 1);
    assert.equal(r.gift.valueYen, 2040);
  });

  it("主語つき「手作りご飯4セットご注文のお客様に非売品ご飯プレゼント」→ category 手作りご飯; (100g×3コ入り) はCに化けない", () => {
    const name =
      "馬肉尽くしの関節ケアご飯♡手作りご飯4セットご注文のお客様に非売品ご飯プレゼント♡(100g×3コ入り♡)";
    const rules = parseBonusRules(name);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].kind, "gift");
    assert.deepEqual(rules[0].scope, { type: "category", family: "手作りご飯" });
  });
});

describe("parseBonusRule — C: included bonus", () => {
  it("「3コ＋おまけ1コのお得セット」「3コセット＋おまけ1コ入り」「3コ入り＋1おまけ」「3セット＋1コ付き」", () => {
    for (const name of [
      "本日限定！ペロリ♪3コ＋おまけ1コのお得セット♡",
      "3コセット＋おまけ1コ入り！飲む点滴♪甘酒♡",
      "本日限定！30種ふりかけ！味比べ3コ入り＋1おまけ♡",
      "3セット＋1コ付き！♡グルコサミンの力！ふりかけグラノーラ♡",
    ]) {
      const r = parseBonusRule(name);
      assert.equal(r?.kind, "included", name);
      if (r?.kind !== "included") return;
      assert.equal(r.baseCount, 3, name);
      assert.equal(r.includedCount, 1, name);
    }
  });

  it("B+C 複合タイトルは両方返し、主ルールはB", () => {
    const name =
      "新発売♡【豪華3コ＋1コ入り♡】若鶏で作る♪手作りご飯4セットご注文のお客様に非売品ご飯プレゼント！";
    const rules = parseBonusRules(name);
    assert.deepEqual(rules.map((r) => r.kind).sort(), ["gift", "included"]);
    assert.equal(parseBonusRule(name)?.kind, "gift");
  });
});

describe("parseBonusRule — 除外(おまけではない)", () => {
  for (const name of [
    "40g増量！『こだわりドックフード♡』2セットご注文ごとのお得を見逃さないで♡",
    "thank you500円OFF♡『美容ふりかけ素♡涙やけ＋内臓ケア＋関節ケア』",
    "送料無料1500円OFF♡10兆個の乳酸菌、ひきわり納豆＋かぼちゃのイタリアン！セット便♡",
    "【2袋合計60g増量】静岡県産♡鴨肉＋手作りチーズのこだわりドックフード！",
  ]) {
    it(name.slice(0, 24), () => assert.equal(parseBonusRule(name), null));
  }
});

describe("computeOrderBonuses — 実注文フィクスチャ", () => {
  it("9915: 別閾値の2商品はそれぞれ単独発動(合算しない)", () => {
    const res = computeOrderBonuses([
      {
        productName:
          "【関節トリプルアプローチ！】ペロリ♪合計3コご注文で＋1コプレゼント♡30種ふりかけと合わせてもOK！",
        quantity: 3,
      },
      {
        productName:
          "『美容ふりかけ素♡』2コご注文で＋1コプレゼント♡(10兆個ふりかけと合わせてもOK！)",
        quantity: 2,
      },
    ]);
    assert.equal(res.totalBonusCount, 2);
    assert.ok(res.items.every((r) => r.activated && !r.pooled));
  });

  it("9468: ドックフード合算 2+1+1=4 → floor仕様で +2", () => {
    const dog = (n: string) =>
      `${n}♡こだわりドックフード！どのドックフードでも2コご注文で＋1コプレゼント♡`;
    const res = computeOrderBonuses([
      { productName: dog("鯛"), quantity: 2 },
      { productName: dog("お守り"), quantity: 1 },
      { productName: dog("ポーク"), quantity: 1 },
    ]);
    assert.equal(res.totalBonusCount, 2);
    assert.ok(res.items.every((r) => r.activated && r.pooled && r.bonusCount === 2));
    assert.equal(res.pools.filter((p) => p.activated).length, 1);
  });

  it("8281: ルール無し商品が数量だけ寄与(contributor)して発動", () => {
    const res = computeOrderBonuses([
      {
        productName:
          "50種の栄養グラノーラ♡どのグラノーラでも4コご注文で＋1コプレゼント♡",
        quantity: 2,
      },
      { productName: "希少♡50種グラノーラ！胃腸回復！", quantity: 2 },
    ]);
    assert.equal(res.totalBonusCount, 1);
    assert.equal(res.items[1].rule, null);
    assert.ok(res.items[1].contributedTo);
    assert.ok(res.items[1].activated && res.items[1].pooled);
  });

  it("8773: A/Bタプル混在ミートローフは合算せずヒントのみ(過大表示しない)", () => {
    const res = computeOrderBonuses([
      {
        productName:
          "内臓回復ミートローフ♡3セットご注文で手作りご飯(2040円〜)1セットプレゼント！",
        quantity: 1,
      },
      {
        productName:
          "美容ミートローフ！3セットご注文で手作りご飯(2040円〜)1セットプレゼント！",
        quantity: 1,
      },
      {
        productName:
          "ミートローフ♡どのミートローフでも合計3コご注文で ＋1コプレゼント！",
        quantity: 1,
      },
    ]);
    assert.equal(res.totalBonusCount, 0);
    assert.deepEqual(res.gifts, []);
    assert.ok(res.items.some((r) => r.hint === "maybe-poolable"));
  });

  it("5861: 手作りご飯4種×1 → 非売品ご飯プレゼント", () => {
    const gohan = (n: string) =>
      `${n}ご飯♡手作りご飯4セットご注文のお客様に非売品ご飯プレゼント♡(100g×3コ入り♡)`;
    const res = computeOrderBonuses([
      { productName: gohan("馬肉の力"), quantity: 1 },
      { productName: gohan("内臓ケア"), quantity: 1 },
      { productName: gohan("自然治癒力向上"), quantity: 1 },
      { productName: gohan("関節ケア"), quantity: 1 },
    ]);
    assert.equal(res.totalBonusCount, 0);
    assert.deepEqual(res.gifts, [{ label: "非売品ご飯", count: 1, unit: null }]);
  });

  it("floor仕様: 3コで+1 を7コ購入 → +2", () => {
    const res = computeOrderBonuses([
      { productName: "ペロリ♪3コご注文で＋1コプレゼント♡", quantity: 7 },
    ]);
    assert.equal(res.totalBonusCount, 2);
  });

  it("C同梱: セット2点 → おまけ2コ、常時発動", () => {
    const res = computeOrderBonuses([
      { productName: "本日限定！ペロリ♪3コ＋おまけ1コのお得セット♡", quantity: 2 },
    ]);
    assert.equal(res.totalBonusCount, 2);
    assert.ok(res.items[0].activated);
    assert.equal(res.items[0].includedBonusCount, 2);
  });

  it("未達の単品ルールは発動しない", () => {
    const res = computeOrderBonuses([
      { productName: "ペロリ♪3コご注文で＋1コのプレゼント♡", quantity: 2 },
    ]);
    assert.equal(res.totalBonusCount, 0);
    assert.equal(res.items[0].activated, false);
    assert.equal(res.items[0].hint, null);
  });
});
