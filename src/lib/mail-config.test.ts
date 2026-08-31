import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMailConfig,
  buildReminderBody,
  buildReminderSubject,
  classifySmtpError,
  isRetryable,
  normalizeAppPassword,
  parseRecipients,
} from "./mail-config";

describe("normalizeAppPassword — 4桁ずつ区切って表示されるので空白が入る", () => {
  it("空白を取り除く", () => {
    assert.equal(normalizeAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
    assert.equal(normalizeAppPassword("abcd　efgh　ijkl　mnop"), "abcdefghijklmnop");
    assert.equal(normalizeAppPassword(" abcdefghijklmnop "), "abcdefghijklmnop");
  });
  it("16桁でなければ null", () => {
    assert.equal(normalizeAppPassword("abcdefghijklmno"), null);
    assert.equal(normalizeAppPassword("abcdefghijklmnopq"), null);
    assert.equal(normalizeAppPassword(""), null);
    assert.equal(normalizeAppPassword(undefined), null);
  });
  it("英字以外が混ざっていれば null（貼り間違い）", () => {
    assert.equal(normalizeAppPassword("abcd-efgh-ijkl-mn"), null);
    assert.equal(normalizeAppPassword("abcd1234efgh5678"), null);
  });
});

describe("parseRecipients", () => {
  it("カンマ・空白・改行のどれでも区切れる", () => {
    assert.deepEqual(parseRecipients("a@example.com, b@example.com"), [
      "a@example.com",
      "b@example.com",
    ]);
    assert.deepEqual(parseRecipients("a@example.com\nb@example.com"), [
      "a@example.com",
      "b@example.com",
    ]);
  });
  it("重複を取り除く（同じ人に2通行かないように）", () => {
    assert.deepEqual(parseRecipients("a@example.com, A@Example.com"), ["a@example.com"]);
  });
  it("形になっていないものは捨てる", () => {
    assert.deepEqual(parseRecipients("not-an-email, b@example.com"), ["b@example.com"]);
    assert.deepEqual(parseRecipients(""), []);
    assert.deepEqual(parseRecipients(undefined), []);
  });
  it("多すぎる宛先を切る", () => {
    const many = Array.from({ length: 9 }, (_, i) => `p${i}@example.com`).join(",");
    assert.equal(parseRecipients(many).length, 5);
  });
});

describe("buildMailConfig — 1つでも欠けたら機能ごと隠す", () => {
  const full = {
    GMAIL_USER: "me@gmail.com",
    GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
    HEARTWORM_MAIL_TO: "a@example.com,b@example.com",
  };
  it("揃っていれば作る", () => {
    assert.deepEqual(buildMailConfig(full), {
      user: "me@gmail.com",
      appPassword: "abcdefghijklmnop",
      to: ["a@example.com", "b@example.com"],
    });
  });
  it("欠けたら null", () => {
    assert.equal(buildMailConfig({ ...full, GMAIL_USER: undefined }), null);
    assert.equal(buildMailConfig({ ...full, GMAIL_USER: "not-an-email" }), null);
    assert.equal(buildMailConfig({ ...full, GMAIL_APP_PASSWORD: "short" }), null);
    assert.equal(buildMailConfig({ ...full, HEARTWORM_MAIL_TO: "" }), null);
    assert.equal(buildMailConfig({}), null);
  });
});

const TODAY = "2026-08-31";

describe("buildReminderSubject — 毎回同じだとGmailがスレッドにまとめる", () => {
  it("今日ぶん1件", () => {
    assert.equal(
      buildReminderSubject([{ scheduledDate: TODAY, label: null }], TODAY),
      "【フィラリア】今日 2026年8月31日 は投薬日です",
    );
  });
  it("取りこぼし1件", () => {
    assert.equal(
      buildReminderSubject([{ scheduledDate: "2026-08-28", label: null }], TODAY),
      "【フィラリア】2026年8月28日の投薬がまだです",
    );
  });
  it("複数件", () => {
    assert.equal(
      buildReminderSubject(
        [
          { scheduledDate: "2026-08-28", label: null },
          { scheduledDate: TODAY, label: null },
        ],
        TODAY,
      ),
      "【フィラリア】未投薬が2件あります（2026年8月31日時点）",
    );
  });
  it("日付が入るので日ごとに件名が変わる", () => {
    const a = buildReminderSubject([{ scheduledDate: TODAY, label: null }], TODAY);
    const b = buildReminderSubject(
      [{ scheduledDate: "2026-09-30", label: null }],
      "2026-09-30",
    );
    assert.notEqual(a, b);
  });
});

describe("buildReminderBody", () => {
  it("薬名があれば載せる", () => {
    const body = buildReminderBody(
      [{ scheduledDate: TODAY, label: "モキシデック" }],
      TODAY,
      "https://example.com/care",
    );
    assert.match(body, /今日 予定（モキシデック）/);
    assert.match(body, /https:\/\/example\.com\/care/);
    assert.match(body, /記録すると次回から通知は止まります/);
  });
  it("URLが無くても壊れない", () => {
    const body = buildReminderBody([{ scheduledDate: TODAY, label: null }], TODAY);
    assert.match(body, /今日 予定/);
    assert.doesNotMatch(body, /undefined/);
  });
});

describe("classifySmtpError", () => {
  it("認証・拒否・通信を見分ける", () => {
    assert.equal(classifySmtpError({ code: "EAUTH" }), "auth");
    assert.equal(classifySmtpError({ responseCode: 535 }), "auth");
    assert.equal(classifySmtpError({ code: "EENVELOPE" }), "rejected");
    assert.equal(classifySmtpError({ responseCode: 550 }), "rejected");
    assert.equal(classifySmtpError({ code: "ETIMEDOUT" }), "network");
    assert.equal(classifySmtpError({ code: "ESOCKET" }), "network");
    assert.equal(classifySmtpError(new Error("???")), "unknown");
    assert.equal(classifySmtpError(undefined), "unknown");
  });
  it("その場で粘る価値があるのは一時的な失敗だけ", () => {
    assert.equal(isRetryable("network"), true);
    for (const r of ["auth", "rejected", "config", "unknown"] as const) {
      assert.equal(isRetryable(r), false, r);
    }
  });
});
