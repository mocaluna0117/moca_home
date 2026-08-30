import "server-only";

/** 証明書の写真はすべてこの接頭辞の下に置く（トークン発行時の検証キー） */
export const BLOB_PREFIX = "vaccinations/";

export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** HEIC は canvas で変換できない端末があるため、原本のまま受け入れる */
export const ALLOWED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/**
 * ローカル開発ではトークンが無いのが普通。false のときは写真まわりの UI を
 * 出さず、記録の文字情報だけで機能が成立するようにする（カタログ同期ボタンを
 * Vercel 上で隠しているのと同じ考え方）。どこでも throw しない。
 */
export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** DB に保存してよい URL か。Action はクライアント由来の url を受け取るので必須。 */
export function isBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

/**
 * best-effort 削除。SDK は動的 import — トークン未設定の環境で
 * Server Actions のバンドルに巻き込まれないようにする。
 * 失敗しても呼び出し側（DB は既にコミット済み）は続行する。
 */
export async function deleteBlobs(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0 || !isBlobConfigured()) return;
  try {
    const { del } = await import("@vercel/blob");
    await del(pathnames);
  } catch {
    // 孤児が残るだけで実害はない（`vercel blob list vaccinations/` で確認できる）
  }
}
