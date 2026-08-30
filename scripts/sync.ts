/**
 * CLI entry for the scraper.
 *   npm run sync                 # full order sync
 *   npm run sync -- --login-only # verify credentials + pagination only
 *   npm run sync -- --catalog    # catalog ID sweep (first run ~30 min)
 */
import { runCatalogSync } from "@/lib/scraper/catalog";
import { failActiveRuns } from "@/lib/scraper/runs";
import { probeLogin, runSync, type SyncProgress } from "@/lib/scraper/sync";

// Ctrl-C mid-run: close the sync_runs row so a rerun starts immediately
// (already-persisted rows are skipped — the sweep self-heals).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    try {
      failActiveRuns("中断されました（Ctrl-C）");
    } finally {
      process.exit(130);
    }
  });
}

async function main() {
  const loginOnly = process.argv.includes("--login-only");
  const catalog = process.argv.includes("--catalog");

  if (catalog) {
    let lastLine = "";
    const s = await runCatalogSync((p) => {
      if (p.phase === "login") return console.log("ログイン中…");
      if (p.phase !== "catalog") return;
      const line = `カタログ探索 ${p.probed}/${p.estimatedTotal} (id=${p.currentId} / 発見 ${p.found} / 404 ${p.notFound}${p.errors ? ` / エラー ${p.errors}` : ""})`;
      if (line === lastLine) return;
      lastLine = line;
      console.log(line);
    });
    console.log(
      `完了: probed=${s.probed} ok=${s.productsOk} 404=${s.productsNotFound} ` +
        `error=${s.productsError} max_live_id=${s.maxLiveId} stopped_at=${s.stoppedAtId}`,
    );
    return;
  }

  if (loginOnly) {
    const info = await probeLogin();
    console.log(
      `ログイン成功 / ${info.totalCount ?? "?"}件・${info.lastPage}ページ検出 ` +
        `(1ページ目 ${info.firstPageOrders}件, 最新注文 ${info.newestOrderId})`,
    );
    return;
  }

  let lastLine = "";
  const write = (line: string) => {
    if (line === lastLine) return;
    lastLine = line;
    console.log(line);
  };

  const onProgress = (p: SyncProgress) => {
    switch (p.phase) {
      case "login":
        return write("ログイン中…");
      case "list":
        return write(`注文一覧 ${p.page}/${p.lastPage} ページ`);
      case "orders":
        return write(`注文詳細 ${p.done}/${p.total}`);
      case "favorites":
        return write(`お気に入り ${p.seen}件を確認`);
      case "products":
        return write(`商品情報 ${p.done}/${p.total}`);
      case "done":
        return;
    }
  };

  const s = await runSync(onProgress);
  console.log(
    `完了: orders=${s.totalOrders} detailed=${s.ordersDetailed} ` +
      `new=${s.ordersInserted} products_ok=${s.productsOk} ` +
      `product_404=${s.productsNotFound} product_error=${s.productsError}`,
  );
}

main().catch((err) => {
  console.error(`同期に失敗しました: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
