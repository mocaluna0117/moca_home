import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_ORDER_FILE_BYTES,
  MAX_ORDER_FILES,
  formatFileSize,
  isImageContentType,
} from "./order-files";

describe("isImageContentType — PDF と写真を分ける", () => {
  it("画像だけ true", () => {
    for (const ok of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
      assert.equal(isImageContentType(ok), true, ok);
    }
    for (const no of ["application/pdf", "text/plain", "", null, undefined]) {
      assert.equal(isImageContentType(no), false, String(no));
    }
  });
});

describe("formatFileSize", () => {
  it("1MB 未満は KB", () => {
    assert.equal(formatFileSize(204800), "200KB");
    assert.equal(formatFileSize(1024), "1KB");
  });

  it("1MB 以上は小数1桁の MB", () => {
    assert.equal(formatFileSize(1024 * 1024), "1.0MB");
    assert.equal(formatFileSize(Math.round(1024 * 1024 * 2.55)), "2.6MB");
    assert.equal(formatFileSize(MAX_ORDER_FILE_BYTES), "10.0MB");
  });

  it("1KB 未満でも 0KB とは言わない（あるものを無いと見せない）", () => {
    assert.equal(formatFileSize(1), "1KB");
    assert.equal(formatFileSize(500), "1KB");
  });

  it("無い・0・壊れた値は null（空の括弧を描かせない）", () => {
    for (const no of [0, -1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatFileSize(no), null, String(no));
    }
  });
});

describe("上限の値", () => {
  it("件数とバイト数がUIとサーバで同じものを指す", () => {
    assert.equal(MAX_ORDER_FILES, 10);
    assert.equal(MAX_ORDER_FILE_BYTES, 10 * 1024 * 1024);
  });
});
