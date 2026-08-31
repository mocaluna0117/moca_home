import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CRON_PATH, cronAuthMatches } from "./cron-auth";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("cronAuthMatches", () => {
  it("正しい Bearer なら通す", () => {
    assert.equal(cronAuthMatches(`Bearer ${SECRET}`, SECRET), true);
  });

  it("値が違えば通さない", () => {
    assert.equal(cronAuthMatches(`Bearer ${SECRET}x`, SECRET), false);
    assert.equal(cronAuthMatches("Bearer wrong", SECRET), false);
  });

  it("Bearer が無ければ通さない", () => {
    assert.equal(cronAuthMatches(SECRET, SECRET), false);
    assert.equal(cronAuthMatches(`bearer ${SECRET}`, SECRET), false);
    assert.equal(cronAuthMatches(`Basic ${SECRET}`, SECRET), false);
  });

  it("ヘッダが無ければ通さない", () => {
    assert.equal(cronAuthMatches(null, SECRET), false);
    assert.equal(cronAuthMatches(undefined, SECRET), false);
    assert.equal(cronAuthMatches("", SECRET), false);
  });

  it("CRON_SECRET が未設定なら誰も通さない（開けっ放しにしない）", () => {
    assert.equal(cronAuthMatches(`Bearer ${SECRET}`, undefined), false);
    assert.equal(cronAuthMatches("Bearer ", ""), false);
    assert.equal(cronAuthMatches("Bearer short", "short"), false);
  });

  it("パスは1か所で定義する", () => {
    assert.equal(CRON_PATH, "/api/cron/heartworm");
  });
});
