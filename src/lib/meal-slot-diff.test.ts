import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deletableIds } from "./meal-slot-diff";

describe("deletableIds — 既存id ∩ 見えていたid − 更新したid", () => {
  it("見えていた行を飼い主が消したら、削除できる", () => {
    // 2品見えていて、保存では1品目だけ残した
    assert.deepEqual(
      deletableIds({ existingIds: [10, 11], knownIds: [10, 11], keptIds: [10] }),
      [11],
    );
  });

  it("ダイアログを開いている間に他の書き手が入れた行は削除しない", () => {
    // 12 は開いた時点で存在しなかったので knownIds に居ない
    assert.deepEqual(
      deletableIds({ existingIds: [10, 11, 12], knownIds: [10, 11], keptIds: [10] }),
      [11],
    );
  });

  it("更新した行はどう転んでも削除しない", () => {
    assert.deepEqual(
      deletableIds({ existingIds: [10, 11], knownIds: [10, 11], keptIds: [10, 11] }),
      [],
    );
  });

  it("見えていたが既に無くなった行は無視する（別の保存が先に消した）", () => {
    assert.deepEqual(
      deletableIds({ existingIds: [10], knownIds: [10, 11], keptIds: [10] }),
      [],
    );
  });

  it("見えていたid が空なら何も消さない（欠けて届いた日に全消ししない）", () => {
    assert.deepEqual(
      deletableIds({ existingIds: [10, 11], knownIds: [], keptIds: [] }),
      [],
    );
  });

  it("全部空でも空を返す（新規の日に初めて保存したとき）", () => {
    assert.deepEqual(
      deletableIds({ existingIds: [], knownIds: [], keptIds: [] }),
      [],
    );
  });

  it("どの入力に重複があっても、同じ id は1度しか返さない", () => {
    assert.deepEqual(
      deletableIds({
        existingIds: [11, 11, 10, 11],
        knownIds: [11, 10, 11],
        keptIds: [10, 10],
      }),
      [11],
    );
  });

  it("順序は existingIds の順に従う", () => {
    assert.deepEqual(
      deletableIds({
        existingIds: [30, 10, 20],
        knownIds: [10, 20, 30],
        keptIds: [],
      }),
      [30, 10, 20],
    );
  });

  it("★07:59に開き08:00にcronが入れ08:01に夜だけ保存 → 朝の2行が生き残る", () => {
    // 07:59 朝ごはんは0品。ダイアログは何も見ていない
    const knownIds: number[] = [];
    // 08:00 cron が朝ごはんに2品入れた
    const existingIds = [101, 102];
    // 08:01 夜だけ入れて保存。朝のペイロードは空なので更新した行も無い
    const keptIds: number[] = [];

    assert.deepEqual(
      deletableIds({ existingIds, knownIds, keptIds }),
      [],
      "入ったばかりの自動記録が消えようとしている",
    );
  });

  it("同じ場面で飼い主が朝の1品を見ていたなら、その1品だけ消える", () => {
    // 07:59 に 100 が見えていて、08:00 に cron ではなく別経路で 101 が増えた場面。
    // 見た 100 は消せるが、見ていない 101 は残る
    assert.deepEqual(
      deletableIds({ existingIds: [100, 101], knownIds: [100], keptIds: [] }),
      [100],
    );
  });

  it("入力の配列を書き換えない（呼び出し側が同じ配列を使い回す）", () => {
    const existingIds = [10, 11];
    const knownIds = [10, 11];
    const keptIds = [10];
    deletableIds({ existingIds, knownIds, keptIds });
    assert.deepEqual(existingIds, [10, 11]);
    assert.deepEqual(knownIds, [10, 11]);
    assert.deepEqual(keptIds, [10]);
  });
});
