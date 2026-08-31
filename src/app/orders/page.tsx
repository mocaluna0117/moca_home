import Link from "next/link";
import { PackageOpen, SearchX, Star } from "lucide-react";

import { OrderCard } from "@/components/order-card";
import { ProductCard } from "@/components/product-card";
import { SearchLauncher } from "@/components/search-launcher";
import { SegmentedNav } from "@/components/segmented-nav";
import { StatTile } from "@/components/stat-tile";
import {
  getCatalogState,
  getFavoriteProductIds,
  getOrders,
  getProductSummaries,
  getStats,
} from "@/lib/queries";
import { formatYen } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type View = "orders" | "products";

/**
 * 購入履歴の一覧。もとは / の中身そのもので、/ をもかのホームに明け渡すために
 * ここへ移した。
 *
 * ?view= / ?q= / ?fav= を持つのはこのページだけになった（ホームには絞り込む
 * 一覧が無いので searchParams を受け取らない）。詳細の /orders/[id] は前から
 * あったので、これで一覧と詳細が同じ接頭辞に揃う。
 */
export default async function OrdersPage({
  searchParams,
}: PageProps<"/orders">) {
  const params = await searchParams;
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: View = rawView === "products" ? "products" : "orders";
  const rawQ = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = rawQ?.trim() || undefined;
  const rawFav = Array.isArray(params.fav) ? params.fav[0] : params.fav;
  const favoritesOnly = rawFav === "1";

  const stats = await getStats();

  // 同期前はタブもスタットも0を並べるだけになるので、案内1枚に畳む。
  // ホームには別の玄関があるので、この早期リターンはこちらだけが持つ。
  if (stats.orderCount === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <PackageOpen className="size-10 text-muted-foreground" />
        <h1 className="font-heading text-lg">まだ購入履歴がありません</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          右上の「同期」を押すとストアから購入履歴を取得します。
          初回同期は全件取得のため 2〜3 分かかります。
        </p>
      </div>
    );
  }

  const [orders, catalogState, productSummaries, favoriteIds] = await Promise.all([
    view === "orders" ? getOrders(q) : Promise.resolve([]),
    getCatalogState(),
    view === "products"
      ? getProductSummaries(q, { favoritesOnly })
      : Promise.resolve([]),
    getFavoriteProductIds(),
  ]);
  const catalogSynced = catalogState.count > 100;
  const isEmptyResult =
    view === "orders" ? orders.length === 0 : productSummaries.length === 0;

  const hrefFor = (value: View) => {
    const search = new URLSearchParams();
    if (value === "products") search.set("view", "products");
    if (q) search.set("q", q);
    if (favoritesOnly && value === "products") search.set("fav", "1");
    const s = search.toString();
    return s ? `/orders?${s}` : "/orders";
  };

  // 「お気に入りだけ」トグル（?q= と併用できる）
  const favHref = (() => {
    const search = new URLSearchParams();
    search.set("view", "products");
    if (q) search.set("q", q);
    if (!favoritesOnly) search.set("fav", "1");
    return `/orders?${search.toString()}`;
  })();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-heading text-lg">購入履歴</h1>

      <section className="grid grid-cols-3 gap-3">
        <StatTile label="注文数" value={`${stats.orderCount}件`} />
        <StatTile label="購入品目" value={`${stats.itemCount}件`} />
        <StatTile label="合計金額" value={formatYen(stats.totalSpentYen)} />
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedNav
          items={[
            { value: "orders", label: "注文ごと", href: hrefFor("orders") },
            { value: "products", label: "商品ごと", href: hrefFor("products") },
          ]}
          current={view}
        />
        <div className="flex items-center gap-2">
          {view === "products" && (
            <Link
              href={favHref}
              scroll={false}
              aria-pressed={favoritesOnly}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                favoritesOnly
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Star
                className={cn("size-4", favoritesOnly && "fill-background")}
                aria-hidden="true"
              />
              お気に入り
            </Link>
          )}
          <SearchLauncher />
        </div>
      </div>

      {isEmptyResult ? (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
          <SearchX className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            「{q}」に一致する商品はありませんでした。
          </p>
        </div>
      ) : view === "orders" ? (
        <>
          <p className="text-xs text-muted-foreground tabular-nums">
            {orders.length}件の注文
          </p>
          <div className="flex flex-col gap-4">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                catalogSynced={catalogSynced}
                favoriteIds={favoriteIds}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground tabular-nums">
            {productSummaries.length}種類の商品
          </p>
          {favoritesOnly && (
            <p className="text-xs text-muted-foreground">
              購入・おまけの履歴があるお気に入りだけを表示しています。
              買ったことのないお気に入りは{" "}
              <Link href="/favorites" className="underline">
                お気に入り一覧
              </Link>{" "}
              にあります。
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {productSummaries.map((product) => (
              <ProductCard key={product.key} product={product} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
