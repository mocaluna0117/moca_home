/**
 * 注文の添付ファイルの、純粋な値と判定。
 *
 * DB も React も import しない（care.ts / meal-amount.ts と同じ立ち位置で、
 * tsx --test で単体実行できる）。
 *
 * **ここに定数を置く理由**: 保存する Server Action（actions.ts）は
 * "use server" なので、非同期関数以外を export できない（ビルドが
 * 「Only async functions are allowed to be exported」で落ちる）。
 * 検証する側（サーバ）と、上限を文で出す側（クライアント）が同じ値を
 * 見るために、両方が import できる場所に置く。
 */

/** 1注文に添付できる数。領収書と梱包の写真を数枚、で足りる */
export const MAX_ORDER_FILES = 10;

/** 1件の上限。領収書のPDFは数百KB、写真も縮小して上げるので10MBで足りる */
export const MAX_ORDER_FILE_BYTES = 10 * 1024 * 1024;

/**
 * 写真か。**PDF と分けるためだけの判定**で、これが false のものは
 * サムネイルを作らずファイル名の行にする（PDF は中身を絵にできない）。
 */
export function isImageContentType(contentType: string | null | undefined): boolean {
  return typeof contentType === "string" && contentType.startsWith("image/");
}

/**
 * 「200KB」「1.5MB」。表示だけなので厳密さより短さを取る。
 * 0 と null は「無い」と同じ扱いで null を返す（空の括弧を描かせない）。
 */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 1) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
