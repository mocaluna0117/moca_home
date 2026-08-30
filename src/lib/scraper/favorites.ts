import "server-only";

import { inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { productFavorites, products } from "@/lib/db/schema";
import { planFavoriteImport, type FavoriteState } from "@/lib/favorites";
import { nowJstIso } from "@/lib/format";

import { HttpClient, ScraperError } from "./client";
import { parseFavoritePage, type ParsedFavoritePage } from "./parse";

/** ページャが暴走したときの安全弁（現状5件・1ページ） */
const MAX_FAVORITE_PAGES = 20;

const now = nowJstIso;

export interface FavoriteImportResult {
  /** ショップ側のお気に入り件数 */
  seen: number;
  /** 新規に星がついた数 */
  added: number;
  /** ローカルで外していたため復活させなかった数 */
  skipped: number;
  /** ショップから消えたので shop_favorite を下ろした数 */
  cleared: number;
  /** products にスタブを作った数（この後の商品エンリッチが取得する） */
  stubbed: number;
  pages: number;
}

function origin(client: HttpClient) {
  return new URL(client.baseUrl).origin;
}

/**
 * 1ページ取得。セッション切れの 302 を SESSION_EXPIRED に翻訳するので、
 * withSession() が1回だけ再ログインして再生できる。
 */
export async function fetchFavoritePage(
  client: HttpClient,
  pageNo: number,
): Promise<ParsedFavoritePage> {
  const path = pageNo <= 1 ? "/mypage/favorite" : `/mypage/favorite?pageno=${pageNo}`;
  const res = await client.request(path);
  if (res.status === 302 || res.status === 303) {
    if (/mypage\/login/.test(res.location ?? "")) {
      throw new ScraperError(
        "SESSION_EXPIRED: お気に入りページがログイン画面にリダイレクトされました",
      );
    }
    throw new ScraperError(`お気に入りページが転送されました (${res.location})`);
  }
  if (res.status !== 200) {
    throw new ScraperError(`お気に入りページ${pageNo}の取得に失敗 (HTTP ${res.status})`);
  }
  return parseFavoritePage(res.body, origin(client));
}

/** 全ページ走査して商品IDを返す（ショップの表示順を保つ）。 */
export async function fetchShopFavoriteIds(
  client: HttpClient,
): Promise<{ ids: number[]; pages: number }> {
  const ids: number[] = [];
  const seen = new Set<number>();

  const first = await fetchFavoritePage(client, 1);
  for (const it of first.items) {
    if (!seen.has(it.productId)) {
      seen.add(it.productId);
      ids.push(it.productId);
    }
  }

  const lastPage = Math.min(first.lastPage, MAX_FAVORITE_PAGES);
  for (let page = 2; page <= lastPage; page++) {
    const parsed = await fetchFavoritePage(client, page);
    let fresh = 0;
    for (const it of parsed.items) {
      if (seen.has(it.productId)) continue;
      seen.add(it.productId);
      ids.push(it.productId);
      fresh++;
    }
    // 同じページが返り続けるなら止める（ページング破損時の保険）
    if (fresh === 0) break;
  }

  return { ids, pages: Math.max(1, lastPage) };
}

/**
 * ショップのお気に入りをローカルへ取り込む。
 *
 * **starred には一切書かない**（src/lib/favorites.ts の規則）。
 * ローカルで外した星は、ショップ側に残っていても復活しない。
 */
export async function importShopFavorites(
  client: HttpClient,
): Promise<FavoriteImportResult> {
  const { ids, pages } = await fetchShopFavoriteIds(client);
  const inShop = new Set(ids);

  const existingRows = await db
    .select({
      productId: productFavorites.productId,
      starred: productFavorites.starred,
      shopFavorite: productFavorites.shopFavorite,
    })
    .from(productFavorites)
    .all();
  const existing = new Map<number, FavoriteState>(
    existingRows.map((r) => [
      r.productId,
      { starred: r.starred, shopFavorite: r.shopFavorite },
    ]),
  );

  const result: FavoriteImportResult = {
    seen: ids.length,
    added: 0,
    skipped: 0,
    cleared: 0,
    stubbed: 0,
    pages,
  };

  // ショップに居る商品が products に無ければスタブを作る。この直後の
  // 商品エンリッチ（fetch_status='pending' が対象）が同じ実行の中で
  // 名前と画像を埋めてくれる。
  if (ids.length > 0) {
    const known = new Set(
      (
        await db
          .select({ id: products.id })
          .from(products)
          .where(inArray(products.id, ids))
          .all()
      ).map((r) => r.id),
    );
    for (const id of ids) {
      if (known.has(id)) continue;
      await db
        .insert(products)
        .values({ id, fetchStatus: "pending" })
        .onConflictDoNothing()
        .run();
      result.stubbed++;
    }
  }

  // ショップに居るもの
  for (const id of ids) {
    const action = planFavoriteImport(existing.get(id), true);
    if (action.kind === "insert") {
      await db
        .insert(productFavorites)
        .values({
          productId: id,
          starred: true,
          shopFavorite: true,
          source: "shop",
          starredAt: now(),
          shopSeenAt: now(),
          createdAt: now(),
          updatedAt: now(),
        })
        .onConflictDoNothing()
        .run();
      result.added++;
    } else if (action.kind === "mark-in-shop") {
      await db
        .insert(productFavorites)
        .values({
          productId: id,
          starred: true,
          shopFavorite: true,
          source: "shop",
          starredAt: now(),
          shopSeenAt: now(),
          createdAt: now(),
          updatedAt: now(),
        })
        .onConflictDoUpdate({
          target: productFavorites.productId,
          // starred には触れない — 墓標を復活させないための要
          set: { shopFavorite: true, shopSeenAt: now(), updatedAt: now() },
        })
        .run();
      if (action.blockedResurrection) result.skipped++;
    }
  }

  // ショップから消えたもの（星は残し、shop_favorite だけ下ろす）
  for (const [id, state] of existing) {
    if (inShop.has(id)) continue;
    if (planFavoriteImport(state, false).kind !== "clear-in-shop") continue;
    await db
      .insert(productFavorites)
      .values({
        productId: id,
        starred: state.starred,
        shopFavorite: false,
        source: "local",
        createdAt: now(),
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: productFavorites.productId,
        set: { shopFavorite: false, updatedAt: now() },
      })
      .run();
    result.cleared++;
  }

  return result;
}
