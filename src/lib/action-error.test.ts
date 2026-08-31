import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { actionError } from "./action-error";

/**
 * actionError は必ず console.error に詳細を流す。テスト中は出力を捨てる
 * （落ちたテストの読み取りを SQL のダンプで埋めないため）。
 */
const realError = console.error;
before(() => {
  console.error = () => {};
});
after(() => {
  console.error = realError;
});

/** 実測した drizzle の包み方を再現する（DrizzleQueryError → LibsqlError → Error） */
function drizzleError(sqliteMessage: string): Error {
  const inner = new Error(sqliteMessage);
  const libsql = new Error(`SQLITE_ERROR: ${sqliteMessage}`, { cause: inner });
  return new Error(
    `Failed query: insert into "dog_profile" ("id", "name") values (?, ?)\nparams: 1,もか`,
    { cause: libsql },
  );
}

describe("actionError — 画面に出す1行", () => {
  it("SQL とパラメータ値を画面に出さない", () => {
    const msg = actionError(drizzleError("no such table: dog_profile"), "保存に失敗しました");
    assert.ok(!msg.includes("Failed query"), msg);
    assert.ok(!msg.includes("insert into"), msg);
    assert.ok(!msg.includes("params"), msg);
    assert.ok(!msg.includes("もか"), msg);
  });

  it("本当の原因を出す。SQLITE_ の接頭辞は落とす", () => {
    assert.equal(
      actionError(drizzleError("no such table: dog_profile"), "保存に失敗しました"),
      "保存に失敗しました（no such table: dog_profile）",
    );
  });

  it("制約違反も原因が読める", () => {
    assert.equal(
      actionError(drizzleError("NOT NULL constraint failed: dog_profile.name"), "保存に失敗しました"),
      "保存に失敗しました（NOT NULL constraint failed: dog_profile.name）",
    );
  });

  it("自分で throw した日本語の Error はそのまま出す", () => {
    assert.equal(
      actionError(new Error("AUTH_SECRET が未設定です"), "保存に失敗しました"),
      "AUTH_SECRET が未設定です",
    );
  });

  it("cause が無い包みだけのときは fallback に落ちる（SQL を出さない）", () => {
    const bare = new Error("Failed query: select 1\nparams: ");
    assert.equal(actionError(bare, "保存に失敗しました"), "保存に失敗しました");
  });

  it("Error でない値でも落ちない", () => {
    assert.equal(actionError(undefined, "削除に失敗しました"), "削除に失敗しました");
    assert.equal(actionError(null, "削除に失敗しました"), "削除に失敗しました");
    assert.equal(actionError({}, "削除に失敗しました"), "削除に失敗しました");
    assert.equal(actionError("生の文字列", "削除に失敗しました"), "生の文字列");
  });

  it("cause が自分を指す循環でも止まる", () => {
    const e = new Error("Failed query: select 1\nparams: ") as Error & { cause?: unknown };
    e.cause = e;
    assert.equal(actionError(e, "保存に失敗しました"), "保存に失敗しました");
  });
});
