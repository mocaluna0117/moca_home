/**
 * 「いつものご飯」を今日どのスロットに入れるかを決める、純粋なロジック。
 *
 * DB も React も import しない（calendar.ts / heartworm.ts / home.ts と同じ
 * 立ち位置で、tsx --test で単体実行できる）。
 *
 * **「今日」をここで見ない**: この機能で唯一「今日」を知っているのは
 * actions-log.ts の `applyUsualMeals()` で、あれは引数を取らず内部で
 * `todayJst(nowJstIso())` を導出する（＝どの呼び出し元も別の日付を指定できない
 * ＝「遡らない」がチェックではなく構造）。ここは登録の一覧を受けて
 * 「どのスロットを、どの順で、どの品目で書くか」だけを答える。日付を
 * 引数に足したくなったら、それは `applyUsualMeals` に date を足すのと
 * 同じ穴（消した記録が翌日に復活する）なので足さない。
 *
 * **登録の有無が唯一のオン／オフ**: `enabled` フラグは持たない。取り戻しが
 * 無いので「一時停止中」の状態に消費者がいないため、オフ＝品目0件で表す。
 * その表現を実際に効かせているのが `planUsualApply` の「0件のスロットは
 * 落とす」1行。
 */

import type { MealSlot } from "./calendar";

/**
 * 自動で入れるスロット。**朝と夜だけ**（おやつは「いつも」ではない）。
 *
 * `usual_meals.slot` の型は `MealSlot` のまま（テーブルは slot 汎用にして
 * あり、おやつを後から足せる形）。この配列はそのテーブルのうち
 * 「今この機能が適用する範囲」を表す門で、順序はそのまま適用順・表示順
 * （朝 → 夜）になる。
 */
export const USUAL_SLOTS = ["morning", "evening"] as const;
export type UsualSlot = (typeof USUAL_SLOTS)[number];

export function isUsualSlot(v: unknown): v is UsualSlot {
  return typeof v === "string" && (USUAL_SLOTS as readonly string[]).includes(v);
}

/** 登録1品。meal_entries の食べ物側と同じ形 */
export interface UsualItem {
  slot: MealSlot;
  productId: number | null;
  label: string;
  amount: string | null;
  note: string | null;
}

/**
 * スロットごとに分ける。**両方のキーが必ずある**（片方だけ無い戻りにすると
 * 呼び出し側に `?? []` を書かせることになり、書き忘れた画面が落ちる）。
 *
 * スロット内は入力順のまま。呼び出し側（`getUsualMeals`）が seq 順に
 * 並べて渡すので、ここで並べ替えると飼い主が決めた品目の順が崩れる。
 */
export function groupUsualBySlot(
  items: readonly UsualItem[],
): Record<UsualSlot, UsualItem[]> {
  // 型注釈で全キーを要求する。USUAL_SLOTS におやつを足した日は
  // ここが型エラーになって「分け忘れ」に気づける
  const grouped: Record<UsualSlot, UsualItem[]> = { morning: [], evening: [] };
  for (const item of items) {
    // treat や壊れた値は捨てる。テーブルは slot 汎用なので、この関門が
    // 「今回のリリースはおやつを適用しない」を実際に保証している唯一の場所
    if (!isUsualSlot(item.slot)) continue;
    grouped[item.slot].push(item);
  }
  return grouped;
}

/**
 * 適用対象のスロットと品目。
 *
 * - **品目0件のスロットは含めない** — それが飼い主のオフの手段（登録を消す）。
 *   0件のまま返すと `applyUsualMeals` が「空のスロットに0行 INSERT する」
 *   意味のない仕事をし、created/skipped の数字も嘘になる。
 * - 順序は `USUAL_SLOTS` 固定（朝 → 夜）。入力の並びや Map の反復順に
 *   任せると、朝と夜のどちらが先に書かれるかが SQL の行順で変わる。
 */
export function planUsualApply(
  items: readonly UsualItem[],
): { slot: UsualSlot; items: UsualItem[] }[] {
  const grouped = groupUsualBySlot(items);
  return USUAL_SLOTS.filter((slot) => grouped[slot].length > 0).map((slot) => ({
    slot,
    items: grouped[slot],
  }));
}
