/**
 * おまけの写真の、純粋な値。
 *
 * DB も React も import しない（order-files.ts と同じ立ち位置）。
 *
 * **ここに定数を置く理由**: 保存する Server Action（actions.ts）は
 * "use server" なので、非同期関数以外を export できない（ビルドが
 * 「Only async functions are allowed to be exported」で落ちる）。
 * 検証する側（サーバ）と、上限を文で出す側（クライアント）が同じ値を
 * 見るために、両方が import できる場所に置く。
 */

/**
 * 1つのおまけに付けられる枚数。袋の表と裏、中身、同梱の紙 — その程度で
 * 足りる。上限があるのは、一覧の行に無限にサムネイルを並べさせないため。
 */
export const MAX_BONUS_PHOTOS = 8;

/** 1枚の上限。ブラウザで 1200px に縮小してから上げるので 8MB で足りる */
export const MAX_BONUS_PHOTO_BYTES = 8 * 1024 * 1024;
