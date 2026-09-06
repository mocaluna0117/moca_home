import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shortLabel } from "./short-name";

const LONG = "【送料無料】国産 鹿肉 ペロリ 100g×3袋 犬用おやつ";

describe("shortLabel — 登録した短い名前を最優先する", () => {
  it("登録があれば推定を使わない", () => {
    assert.equal(shortLabel(LONG, 10, "ペロリ"), "ペロリ");
  });

  it("登録名も max を超えれば切り詰める（マスの幅は変わらない）", () => {
    assert.equal(shortLabel(LONG, 5, "あいうえおかきく"), "あいうえ…");
  });

  it("空文字や空白だけの登録は「無い」と同じ扱い", () => {
    const estimated = shortLabel(LONG, 10);
    assert.equal(shortLabel(LONG, 10, ""), estimated);
    assert.equal(shortLabel(LONG, 10, "   "), estimated);
    assert.equal(shortLabel(LONG, 10, null), estimated);
    assert.equal(shortLabel(LONG, 10, undefined), estimated);
  });

  it("登録の前後の空白は落とす", () => {
    assert.equal(shortLabel(LONG, 10, "  ペロリ  "), "ペロリ");
  });
});

describe("shortLabel — 登録が無いときは今までどおり", () => {
  it("max 以下ならそのまま", () => {
    assert.equal(shortLabel("ミートローフ", 10), "ミートローフ");
  });

  it("超えたら末尾を … にして max 文字以下にする", () => {
    const out = shortLabel("あいうえおかきくけこさしすせそ", 6);
    assert.equal(out, "あいうえお…");
    assert.ok(out.length <= 6);
  });

  it("空文字は空文字", () => {
    assert.equal(shortLabel("", 10), "");
    assert.equal(shortLabel("   ", 10), "");
  });

  it("絵文字の途中で切らない", () => {
    const out = shortLabel("🐕🐕🐕🐕🐕🐕", 4, null);
    // サロゲートペアの片割れを残さない（残すと豆腐になる）
    assert.ok(!/[\uD800-\uDBFF]$/.test(out.replace("…", "")));
  });
});
