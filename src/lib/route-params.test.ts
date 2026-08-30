import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseIdParam } from "./route-params";

describe("parseIdParam — 数値IDだけを通す", () => {
  it("素の正の整数は通る", () => {
    assert.equal(parseIdParam("1"), 1);
    assert.equal(parseIdParam("9915"), 9915);
    assert.equal(parseIdParam("1234567890"), 1234567890);
  });

  it("拡張子つきを弾く（認証ゲートを迂回されないための要）", () => {
    for (const v of ["1.jpg", "1.png", "1.webp", "1.svg", "1.ico", "1.jpeg"]) {
      assert.equal(parseIdParam(v), null, v);
    }
  });

  it("parseInt が通してしまう形を弾く", () => {
    for (const v of [" 1", "1abc", "1 ", "+1", "1e3", "0x10", "1.0"]) {
      assert.equal(parseIdParam(v), null, v);
    }
  });

  it("0・負数・先頭ゼロ・巨大な値を弾く", () => {
    for (const v of ["0", "-1", "01", "00", "12345678901"]) {
      assert.equal(parseIdParam(v), null, v);
    }
  });

  it("空・非文字列を弾く", () => {
    assert.equal(parseIdParam(""), null);
    assert.equal(parseIdParam(undefined), null);
    assert.equal(parseIdParam(null), null);
  });
});
