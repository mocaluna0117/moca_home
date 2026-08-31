import Link from "next/link";
import { ChevronRight, ShoppingBag } from "lucide-react";

import { StatTile } from "@/components/stat-tile";
import { formatSyncedAt, formatYen } from "@/lib/format";
import type { HomeSnapshot } from "@/lib/queries-home";

/**
 * 【4】買ったもの。かつてトップの第1要素だった3つの数字を、5ブロックのうち
 * 下から2番目に置く。主題が「買い物」から「もか」に変わったことを、文ではなく
 * 位置で言う。
 *
 * 注文が0件でもページを乗っ取らない（現行トップの全画面 early-return は
 * /orders に残す）。ホームでは破線1枚に縮む。
 */
export function PurchaseSummary({
  stats,
  lastSyncedAt,
}: {
  stats: HomeSnapshot["stats"];
  /** sync_runs.finished_at の生 ISO。整形は formatSyncedAt に任せる */
  lastSyncedAt: string | null;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
          <ShoppingBag className="size-4" aria-hidden="true" />
          買ったもの
        </h2>
        <Link
          href="/orders"
          className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          購入履歴をひらく
          <ChevronRight className="size-3" aria-hidden="true" />
        </Link>
      </div>

      {stats.orderCount === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            購入履歴はまだ取り込まれていません
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            右上の「同期」を押すと 20&amp;20 から取り込みます。初回は全件取得のため
            2〜3 分かかります。
          </p>
        </div>
      ) : (
        // 375px でも3列が成立する（現行トップと同じ構成なので実測済み）
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="注文数" value={`${stats.orderCount}件`} />
          <StatTile label="購入品目" value={`${stats.itemCount}件`} />
          <StatTile label="合計金額" value={formatYen(stats.totalSpentYen)} />
        </div>
      )}

      {/*
        ヘッダーの「最終同期」は電話では隠れるので、そこではここが唯一の表示場所。
        一度も同期していない日は出さない（「最終同期 未同期」は日本語として
        読めないし、上の破線が既に同じことを言っている）。
      */}
      {lastSyncedAt !== null && (
        <p className="text-xs text-muted-foreground tabular-nums">
          最終同期 {formatSyncedAt(lastSyncedAt)}
        </p>
      )}
    </section>
  );
}
