import "server-only";

import { HttpClient, NotFoundError, ScraperError } from "./client";
import { parseProductPage, type ParsedProduct } from "./parse";

/**
 * The shop sells time-limited items whose pages are eventually removed;
 * a 404/410 is expected and surfaces as NotFoundError so the caller can mark
 * the product `not_found` and stop retrying it.
 */
export async function fetchProduct(
  client: HttpClient,
  productId: number,
): Promise<ParsedProduct> {
  const res = await client.request(`/products/detail/${productId}`);
  if (res.status === 404 || res.status === 410) {
    throw new NotFoundError(`商品ページが存在しません (${productId})`);
  }
  // A removed product can also redirect to the list page or the top page.
  if (res.status === 301 || res.status === 302) {
    throw new NotFoundError(`商品ページがリダイレクトされました (${productId})`);
  }
  if (res.status !== 200) {
    throw new ScraperError(`商品 ${productId} の取得に失敗 (HTTP ${res.status})`);
  }
  const parsed = parseProductPage(res.body, new URL(client.baseUrl).origin);
  if (!parsed.name) {
    throw new NotFoundError(`商品ページに商品名がありません (${productId})`);
  }
  return parsed;
}
