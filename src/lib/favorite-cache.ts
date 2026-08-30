/**
 * 星のブラウザ内キャッシュ。
 *
 * ピッカー本体（約300KB・セッション中1回だけ取得）と違い、星は軽いので
 * ダイアログを開くたびに /api/favorites で取り直す。星ボタンを押した直後は
 * サーバーを待たずにここを書き換えて、同一セッションのピン留めを合わせる。
 *
 * catalog-picker と favorite-button の双方から使うため独立させている
 * （どちらかに置くと import が循環する）。
 */
let favoriteIdsCache: Set<number> = new Set();

const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** useSyncExternalStore 用。参照が変わったときだけ再レンダーされる。 */
export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFavoriteCache(): Set<number> {
  return favoriteIdsCache;
}

export function setFavoriteCache(ids: Iterable<number>): Set<number> {
  favoriteIdsCache = new Set(ids);
  emit();
  return favoriteIdsCache;
}

/**
 * 星ボタンを押した直後に呼ぶ。新しい Set にして参照を変え、購読側に通知する
 * （同じダイアログの中の他の行や、ピン留めの並びが即座に追随する）。
 */
export function markFavorite(productId: number, starred: boolean): void {
  const next = new Set(favoriteIdsCache);
  if (starred) next.add(productId);
  else next.delete(productId);
  favoriteIdsCache = next;
  emit();
}
