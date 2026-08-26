import "server-only";

import { HttpClient, ScraperError } from "./client";
import {
  parseOrderDetail,
  parseOrderListPage,
  type ParsedOrderDetail,
  type ParsedOrderListPage,
} from "./parse";

function origin(client: HttpClient) {
  return new URL(client.baseUrl).origin;
}

/** NOTE: the pagination parameter is `pageno` — `page_no` is silently ignored. */
export async function fetchOrderListPage(
  client: HttpClient,
  pageNo: number,
): Promise<ParsedOrderListPage> {
  const res = await client.request(`/mypage/?pageno=${pageNo}`);
  if (res.status !== 200) {
    throw new ScraperError(`注文履歴ページ${pageNo}の取得に失敗 (HTTP ${res.status})`);
  }
  return parseOrderListPage(res.body, origin(client));
}

export async function fetchOrderDetail(
  client: HttpClient,
  orderId: string,
): Promise<ParsedOrderDetail> {
  const res = await client.request(`/mypage/history/${orderId}`);
  if (res.status !== 200) {
    throw new ScraperError(`注文詳細 ${orderId} の取得に失敗 (HTTP ${res.status})`);
  }
  return parseOrderDetail(res.body, origin(client));
}
