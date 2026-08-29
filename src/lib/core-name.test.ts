import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findCoreName, splitCoreName } from "./core-name";

/** Convenience: the extracted substring, or null. */
function core(title: string): string | null {
  const s = findCoreName(title);
  return s ? title.slice(s.start, s.end) : null;
}

describe("findCoreName — 実データのタイトル", () => {
  const cases: Array<[string, string]> = [
    [
      "9:00〜9:30♡30分限定販売！【新しくなったよ♡関節トリプルアプローチ！】乳酸菌とアミノ酸コラーゲン！ペロリ♪合計3コご注文で＋1コプレゼント♡30種ふりかけと合わせてもOK！",
      "ペロリ",
    ],
    [
      "『美容ふりかけ素♡涙やけ＋内臓ケア＋関節ケア＋アンチエイジング♪』2コご注文で＋1コプレゼント♡(10兆個ふりかけと合わせてもOK！)",
      "美容ふりかけ素",
    ],
    [
      "おっきな！ミートローフ♡ 北海道産♡エゾ鹿肉＋若鶏の吐かない体質作り♡やさしく守る♪ 特濃ヤギミルク！『免疫力向上＋胃腸ケア』♡ どのミートローフでも3セットご注文で手作りご飯2040円〜1セットプレゼント♡",
      "ミートローフ",
    ],
    [
      "新発売♡30g増量！【涙やけ革命】 ザクザク乳酸菌×発酵納豆ふりかけ♡ルテイン×コラーゲンでうるうる瞳ケア♡どの納豆ふりかけでも3コご注文で＋1コプレゼント！",
      "納豆ふりかけ",
    ],
    [
      "新発売♡【体調不良を感じたら＋血液検査の数値を戻す時に】お守りドックフード♡瞳うるうる♪関節しなやか♪心臓いきいきトリプルケア♡どのドックフードでも2コご注文で＋1コプレゼント♡発送は6月14日〜16日目安♡",
      "お守りドックフード",
    ],
    [
      "【9:00〜10:00数量限定♡】新発売♡【食べる10兆個の乳酸菌美容♡】腸活×涙やけサポート！白桃とヤギミルクのご褒美クッキー♪2コご注文で＋1コプレゼント♡メロンヤギミルクと合わせてもOK！",
      "ご褒美クッキー",
    ],
    [
      "【ふりかけ♡】長寿の秘訣♡獣医さんおすすめ♡有機納豆＋北海道産！帆立の和食ふりかけ♡3コご注文で＋1コプレゼント♡(どの納豆ふりかけと合わせてもOK！)",
      "和食ふりかけ",
    ],
  ];
  for (const [title, expected] of cases) {
    it(`${expected} ← ${title.slice(0, 20)}…`, () =>
      assert.equal(core(title), expected));
  }
});

describe("findCoreName — 不変条件", () => {
  it("span は必ず元の文字列の部分文字列を指す", () => {
    const title = "新発売♡ポークが最高♡マゼマゼ♪ドックフード！2コご注文で＋1コプレゼント♡";
    const s = findCoreName(title)!;
    assert.ok(s.start >= 0 && s.end <= title.length && s.start < s.end);
    assert.ok(title.includes(title.slice(s.start, s.end)));
  });

  it("splitCoreName は連結すると元のタイトルに完全一致する（一字も失わない）", () => {
    for (const title of [
      "おっきな♡ミートローフ！静岡県産♡若鶏＋かぼちゃ仕立て♪",
      "『いちご好きに贈る♡大自然の苺グラノーラ🍓🍓🍓』",
      "抽出できない適当な文字列",
    ]) {
      const [a, b, c] = splitCoreName(title);
      assert.equal(a + b + c, title, title);
    }
  });

  it("おまけ条件の中の商品名は拾わない", () => {
    // 「どのミートローフでも」はおまけ条件であって、この商品の名前ではない
    const title =
      "50種の栄養グラノーラ♡どのミートローフでも3セットご注文で手作りご飯プレゼント♡";
    assert.equal(core(title), "50種の栄養グラノーラ");
  });

  it("抽出できないタイトルは null（強調なしで全文表示になる）", () => {
    assert.equal(findCoreName(""), null);
    assert.equal(findCoreName("あいうえお"), null);
  });

  it("絵文字を含んでもサロゲートペアを割らない", () => {
    const title = "『カジカジポークさん♡』🐷💖";
    const s = findCoreName(title);
    if (s) {
      const c = title.charCodeAt(s.end);
      assert.ok(Number.isNaN(c) || c < 0xdc00 || c > 0xdfff);
    }
  });
});
