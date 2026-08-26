/**
 * CLI entry for the scraper.
 *   npm run sync                 # full sync
 *   npm run sync -- --login-only # verify credentials + pagination only
 */
import { probeLogin, runSync, type SyncProgress } from "@/lib/scraper/sync";

async function main() {
  const loginOnly = process.argv.includes("--login-only");

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
