import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planFavoriteImport, type FavoriteState } from "./favorites";

const state = (starred: boolean, shopFavorite: boolean): FavoriteState => ({
  starred,
  shopFavorite,
});

describe("planFavoriteImport — 3状態 × ショップ有無", () => {
  it("行が無い × ショップにある → 新規に星をつける", () => {
    assert.deepEqual(planFavoriteImport(undefined, true), { kind: "insert" });
  });

  it("行が無い × ショップに無い → 何もしない（行を作らない）", () => {
    assert.deepEqual(planFavoriteImport(undefined, false), { kind: "none" });
  });

  it("星ON × ショップにある → 既知なら何もしない（冪等）", () => {
    assert.deepEqual(planFavoriteImport(state(true, true), true), { kind: "none" });
  });

  it("星ON（ショップ未知）× ショップにある → shop_favorite を立てる", () => {
    assert.deepEqual(planFavoriteImport(state(true, false), true), {
      kind: "mark-in-shop",
      blockedResurrection: false,
    });
  });

  it("★墓標（星OFF）× ショップにある → 星は復活させない", () => {
    const action = planFavoriteImport(state(false, true), true);
    assert.equal(action.kind, "mark-in-shop");
    assert.equal(
      action.kind === "mark-in-shop" && action.blockedResurrection,
      true,
      "外した星が復活しようとしている",
    );
  });

  it("星ON × ショップに無い → shop_favorite を下ろすだけ（星は残す）", () => {
    assert.deepEqual(planFavoriteImport(state(true, true), false), {
      kind: "clear-in-shop",
    });
  });

  it("墓標 × ショップに無い → 何もしない（墓標は永続）", () => {
    assert.deepEqual(planFavoriteImport(state(false, false), false), {
      kind: "none",
    });
  });

  it("取り込みを2回続けても2回目は書き込みが起きない（冪等）", () => {
    // 1回目: 新規
    assert.equal(planFavoriteImport(undefined, true).kind, "insert");
    // 2回目: insert 後の状態で回すと none
    assert.equal(planFavoriteImport(state(true, true), true).kind, "none");
  });
});
