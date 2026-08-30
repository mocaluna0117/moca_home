"use client";

/**
 * 20&20 のカタログから商品を選ぶピッカー。
 *
 * おまけ記録と食事記録の両方から使うため、received-bonus-dialog から
 * そのまま抽出したもの（挙動は変えていない）。
 * - カタログ全件(約1,120件)を初回だけ /api/catalog から取得しモジュールに
 *   キャッシュする。RSC のレンダーには載せない
 * - 絞り込みはクライアント側の String.includes（IME 変換中でも走らない）
 * - 商品詳細は開いたときだけ /api/catalog/[id] を叩き、こちらもキャッシュ
 */

import { ArrowLeft, ExternalLink, Gift, Info } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";

import { formatRuleLong } from "@/components/bonus-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductName } from "@/components/product-name";
import { FavoriteButton } from "@/components/favorite-button";
import { parseBonusRule } from "@/lib/bonus";
import {
  getFavoriteCache,
  setFavoriteCache,
  subscribeFavorites,
} from "@/lib/favorite-cache";
import { formatYen } from "@/lib/format";

export interface CatalogItem {
  id: number;
  name: string;
  priceYen: number | null;
  imageUrl: string | null;
}

// モジュールレベルのキャッシュ: ブラウザのセッション中に1回だけ取得する
let catalogCache: CatalogItem[] | null = null;



/** ダイアログを開いたときに呼ぶ。取得済みなら即返す。 */
export function useCatalog(open: boolean): CatalogItem[] | null {
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(catalogCache);

  useEffect(() => {
    if (!open || catalogCache) return;
    let alive = true;
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((data: { items: CatalogItem[] }) => {
        catalogCache = data.items;
        if (alive) setCatalog(data.items);
      })
      .catch(() => alive && setCatalog([]));
    return () => {
      alive = false;
    };
  }, [open]);

  return catalog;
}

/** 開くたびに軽いエンドポイントから星を取り直す。 */
export function useFavoriteIds(open: boolean): Set<number> {
  // キャッシュを購読する。星ボタンを押すと markFavorite が通知するので、
  // 同じダイアログ内の表示とピン留めの並びが即座に追随する。
  const ids = useSyncExternalStore(
    subscribeFavorites,
    getFavoriteCache,
    getFavoriteCache,
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/favorites")
      .then((res) => res.json())
      .then((data: { ids: number[] }) => {
        if (alive) setFavoriteCache(data.ids);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  return ids;
}

const PICKER_LIMIT = 50;

export function CatalogPicker({
  catalog,
  query,
  onSelect,
  onPreview,
  favoriteIds,
}: {
  catalog: CatalogItem[] | null;
  query: string;
  onSelect: (item: CatalogItem) => void;
  onPreview: (item: CatalogItem) => void;
  /** 星がついた商品。検索していないときは先頭に固定表示する */
  favoriteIds?: Set<number>;
}) {
  if (catalog === null) {
    return (
      <p className="text-xs text-muted-foreground">商品リストを読み込み中…</p>
    );
  }

  const term = query.trim();
  const matches =
    term === "" ? catalog : catalog.filter((c) => c.name.includes(term));

  // 検索していないときは、お気に入りを先頭に固定する。毎日の食事記録で
  // 1,120件から探し直さずに済むのがこの機能の主目的。
  // 検索を始めたら絞り込みが主役なので固定は解除し、代わりに該当する
  // お気に入りを上に寄せる（見失わないように）。
  const favs = favoriteIds ?? new Set<number>();
  const pinned = term === "" ? matches.filter((c) => favs.has(c.id)) : [];
  const rest =
    term === ""
      ? matches.filter((c) => !favs.has(c.id))
      : [...matches].sort(
          (a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)),
        );
  const shown = [...pinned, ...rest].slice(0, PICKER_LIMIT);

  return (
    <>
      {/* 専用モーダルに移したので、行が高くなるモバイルでも数件は見えるよう
          画面基準で伸ばす（商品名は60〜140文字あり1件で8行になる） */}
      <ul className="max-h-[min(60vh,32rem)] divide-y overflow-y-auto rounded border">
        {shown.map((c) => (
          <li key={c.id} className="flex items-stretch">
            <button
              type="button"
              className="flex flex-1 items-start gap-2 p-2 text-left hover:bg-muted"
              onClick={() => onSelect(c)}
            >
              <Thumb src={c.imageUrl} alt="" />
              <span className="flex-1 text-sm leading-snug break-words">
                <ProductName name={c.name} />
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatYen(c.priceYen)}
              </span>
            </button>
            {/* 選択ボタンの兄弟。入れ子にしないので不正HTMLにならない */}
            <span className="flex shrink-0 items-center border-l px-1">
              <FavoriteButton
                productId={c.id}
                isFavorite={favs.has(c.id)}
                size="sm"
              />
            </span>
            <button
              type="button"
              aria-label={`${c.name} の詳細を見る`}
              title="詳細を見る"
              className="shrink-0 border-l px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onPreview(c)}
            >
              <Info className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="p-3 text-xs text-muted-foreground">
            {catalog.length === 0
              ? "商品リストが空です。ヘッダーの「カタログ同期」を実行してください。"
              : "一致する商品がありません"}
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground tabular-nums">
        {term === ""
          ? pinned.length > 0
            ? `お気に入り ${pinned.length} 件を先頭に表示 ・ 全 ${catalog.length} 件`
            : `全 ${catalog.length} 件（新しい順に ${shown.length} 件を表示・スクロールできます）`
          : `「${term}」に一致 ${matches.length} 件` +
            (matches.length > shown.length
              ? `（上位 ${shown.length} 件を表示）`
              : "")}
      </p>
    </>
  );
}

export interface CatalogProductDetail extends CatalogItem {
  category: string | null;
  tags: string[];
  imageUrls: string[];
  descriptionHtml: string | null;
}

// Details are fetched per product (descriptions are long) and cached for the
// session so re-opening the same product is instant.
const detailCache = new Map<number, CatalogProductDetail>();

/**
 * Full-surface preview inside the record dialog. A nested modal would fight
 * the parent dialog for focus, so this covers the dialog body instead and
 * returns to the picker via 戻る.
 */
export function ProductPreview({
  productId,
  onSelect,
  onClose,
}: {
  productId: number;
  onSelect: (item: CatalogProductDetail) => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState<CatalogProductDetail | null>(
    detailCache.get(productId) ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Cache hits are served by the useState initializer (the component is
    // keyed per product), so the effect only runs the network path.
    if (detailCache.has(productId)) return;
    let alive = true;
    fetch(`/api/catalog/${productId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("not found"))))
      .then((data: { item: CatalogProductDetail }) => {
        detailCache.set(productId, data.item);
        if (alive) setItem(data.item);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [productId]);

  const rule = item ? parseBonusRule(item.name) : null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-3 rounded-xl bg-popover p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          戻る
        </Button>
        <span className="text-sm font-medium">商品の詳細</span>
      </div>

      {failed ? (
        <p className="text-sm text-muted-foreground">
          商品情報を取得できませんでした。
        </p>
      ) : !item ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex gap-3">
            <div className="relative size-28 shrink-0 overflow-hidden rounded border bg-muted">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt=""
                  fill
                  sizes="112px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <Gift className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm leading-snug break-words">
                <ProductName name={item.name} />
              </p>
              <p className="font-semibold tabular-nums">
                {formatYen(item.priceYen)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  税込
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {item.category && (
                  <Badge variant="outline" className="font-normal">
                    {item.category}
                  </Badge>
                )}
                {item.tags.map((t) => (
                  <Badge key={t} variant="outline" className="font-normal">
                    {t}
                  </Badge>
                ))}
                {rule && (
                  <Badge variant="secondary" className="font-normal">
                    <Gift aria-hidden="true" />
                    {formatRuleLong(rule)}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {item.imageUrls.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {item.imageUrls.slice(1).map((src) => (
                <span
                  key={src}
                  className="relative size-14 overflow-hidden rounded border bg-muted"
                >
                  <Image
                    src={src}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                    unoptimized
                  />
                </span>
              ))}
            </div>
          )}

          {item.descriptionHtml && (
            <div
              className="text-xs leading-relaxed break-words text-muted-foreground [&_a]:underline [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full"
              // Sanitized at ingest (parseProductPage strips scripts/handlers).
              dangerouslySetInnerHTML={{ __html: item.descriptionHtml }}
            />
          )}

          <a
            href={`https://20and20.pet/store/products/detail/${item.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            ショップで見る
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t pt-3">
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
        <Button disabled={!item} onClick={() => item && onSelect(item)}>
          この商品を選ぶ
        </Button>
      </div>
    </div>
  );
}

export function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded border bg-muted">
        <Gift className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="relative size-8 shrink-0 overflow-hidden rounded border bg-muted">
      <Image src={src} alt={alt} fill sizes="32px" className="object-cover" unoptimized />
    </span>
  );
}

