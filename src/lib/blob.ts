import "server-only";

/**
 * 写真の保存先の**許可リスト**。用途ごとに接頭辞を1つ持つ。
 *
 * プロフィール写真を足すにあたって、既存の `startsWith(BLOB_PREFIX)` を
 * 「vaccinations/ でも profile/ でもよい」と緩める書き方は採らない。
 * ここはトークン発行と Server Action の両方が通る唯一の関門で、緩める側の
 * 変更は必ず穴になる。用途を列挙し、`parseBlobPath` で**現行より狭く**
 * 判定する（下記 SAFE_LEAF）。
 *
 * 接頭辞は互いの接頭辞になっていない（vaccinations/ と profile/）。
 * これが崩れると parseBlobPath の最初に一致した1件を返す形が壊れるので、
 * 3つ目を足すときは必ず互いに素な語を選ぶ。
 */
export const BLOB_PREFIXES = {
  vaccination: "vaccinations/",
  profile: "profile/",
} as const;

export type BlobKind = keyof typeof BLOB_PREFIXES;

/** 既存呼び出しの互換。証明書だけを指す */
export const BLOB_PREFIX = BLOB_PREFIXES.vaccination;

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
 * 接頭辞の直下1セグメントだけを許す。'/' の追加と '..' を弾く。
 *
 * 先頭を英数字に限るので、`..`・`.` で始まる相対参照はここで落ちる。
 * '/' を字種に含めないので `vaccinations/a/../b` のような入れ子も通らない
 * （現行の startsWith はこれを通していた）。
 */
const SAFE_LEAF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/**
 * Blob の pathname を用途に振り分ける。判定できなければ null。
 *
 * 呼び出し側は必ず `?.kind === "…"` まで見る。null と別用途の kind を
 * 同じ扱いにしないと、profile/ のパスが証明書の Action に流れ込む。
 */
export function parseBlobPath(
  pathname: string,
): { kind: BlobKind; leaf: string } | null {
  for (const kind of Object.keys(BLOB_PREFIXES) as BlobKind[]) {
    const prefix = BLOB_PREFIXES[kind];
    if (!pathname.startsWith(prefix)) continue;
    const leaf = pathname.slice(prefix.length);
    return SAFE_LEAF.test(leaf) ? { kind, leaf } : null;
  }
  return null;
}

/**
 * 用途ごとの受け入れ規則。**profile は vaccination より狭い**。
 *
 * プロフィールが HEIC/HEIF を受けないのは、変換に失敗した原本がそのまま
 * 上がったとき desktop Chrome / Firefox が `<img>` で描けないため。
 * 証明書のサムネイルが出ないのとは重みが違う（顔写真はページの存在理由）。
 * 上限も 8MB — 表示は最大 128px の丸枠で、原寸を持つ意味がない。
 */
export const PHOTO_RULES: Record<
  BlobKind,
  { types: readonly string[]; maxBytes: number }
> = {
  vaccination: { types: ALLOWED_PHOTO_TYPES, maxBytes: MAX_PHOTO_BYTES },
  profile: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxBytes: 8 * 1024 * 1024,
  },
};

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
