/**
 * ショップのお気に入り取り込みの突き合わせ規則。
 * DB も React も import しない純モジュール（tsx --test で単体実行できる）。
 *
 * 唯一の不変条件: **取り込みは starred を書かない**。
 * ローカルで外した星（starred=false の墓標）は、ショップ側にまだ残って
 * いても復活しない。逆に toggleFavorite は shopFavorite / source に
 * 触らない。書き手が列を分け持つことで、この2つが衝突しなくなる。
 */

export type FavoriteSource = "local" | "shop";

/** 突き合わせに必要な既存行の最小形 */
export interface FavoriteState {
  starred: boolean;
  shopFavorite: boolean;
}

export type FavoriteImportAction =
  /** 行が無く、ショップにある → 新規に星をつける */
  | { kind: "insert" }
  /**
   * 行があり、ショップにある → shop_favorite を立てるだけ。
   * blockedResurrection = 墓標だったので星は復活させなかった
   */
  | { kind: "mark-in-shop"; blockedResurrection: boolean }
  /** 行があり、ショップに無い → shop_favorite を下ろすだけ */
  | { kind: "clear-in-shop" }
  /** 書き込み不要 */
  | { kind: "none" };

export function planFavoriteImport(
  existing: FavoriteState | undefined,
  inShop: boolean,
): FavoriteImportAction {
  if (existing === undefined) {
    return inShop ? { kind: "insert" } : { kind: "none" };
  }
  if (inShop) {
    // 既に星ON かつ ショップ既知なら書くことがない（冪等）
    if (existing.shopFavorite && existing.starred) return { kind: "none" };
    return { kind: "mark-in-shop", blockedResurrection: !existing.starred };
  }
  return existing.shopFavorite ? { kind: "clear-in-shop" } : { kind: "none" };
}
