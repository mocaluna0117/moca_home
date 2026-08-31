import { Package, Star } from "lucide-react";
import Link from "next/link";

import { FavoriteButton } from "@/components/favorite-button";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { ProductName } from "@/components/product-name";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatYen } from "@/lib/format";
import { getFavorites } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const favorites = await getFavorites();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <h1 className="font-heading inline-flex items-center gap-1.5 text-lg">
          <Star className="size-4 fill-foreground" aria-hidden="true" />
          お気に入り
        </h1>
        {favorites.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {favorites.length}件
          </span>
        )}
      </div>

      {favorites.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Star className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            まだお気に入りがありません
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            商品の星を押すと、ここに集まります。ショップのお気に入りは同期のときに取り込まれます。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {favorites.map((f) => (
            <li
              key={f.productId}
              className="flex items-start gap-3 rounded-lg border p-3"
            >
              <div className="relative size-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                <ImageWithFallback
                  src={f.imageUrl}
                  alt={f.name}
                  sizes="80px"
                  className="size-full"
                />
              </div>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/products/${f.productId}`}
                  className="line-clamp-2 text-sm leading-snug hover:underline"
                >
                  <ProductName name={f.name} />
                </Link>

                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatYen(f.priceYen)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {f.orderCount > 0
                      ? `${f.orderCount}回購入 ・ 計${f.totalQuantity}点`
                      : "購入なし"}
                  </span>
                  {f.lastOrderedAt && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      最終 {formatDate(f.lastOrderedAt)}
                    </span>
                  )}
                  {f.fetchStatus === "not_found" && (
                    <Badge variant="outline" className="font-normal">
                      販売終了
                    </Badge>
                  )}
                  {f.inShop && (
                    <Badge variant="outline" className="font-normal">
                      ショップにも登録
                    </Badge>
                  )}
                </div>
              </div>

              <FavoriteButton productId={f.productId} isFavorite />
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/orders?view=products"
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Package className="size-3" aria-hidden="true" />
        商品一覧から探す
      </Link>
    </div>
  );
}
