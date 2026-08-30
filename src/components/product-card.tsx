import Link from "next/link";

import { formatRuleShort } from "@/components/bonus-badge";
import { FavoriteButton } from "@/components/favorite-button";
import { ProductName } from "@/components/product-name";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatYen } from "@/lib/format";
import type { ProductSummary } from "@/lib/queries";

export function ProductCard({ product }: { product: ProductSummary }) {
  const body = (
    <>
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        <ImageWithFallback
          src={product.imageUrl}
          alt={product.name}
          sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
          className="size-full"
          iconClassName="size-8"
        />
        {product.freebieOnly && (
          <Badge
            variant="secondary"
            className="absolute bottom-2 left-2 bg-background/90 font-normal"
          >
            おまけのみ
          </Badge>
        )}
        {product.fetchStatus === "not_found" && (
          <Badge
            variant="outline"
            className="absolute top-2 left-2 bg-background/90 font-normal"
          >
            販売終了
          </Badge>
        )}
        {product.productId !== null && (
          // z-20 + relative でカード全体のリンクより手前に出す
          <span className="absolute right-1 bottom-1 z-20 rounded-md bg-background/90">
            <FavoriteButton
              productId={product.productId}
              isFavorite={product.isFavorite}
              size="sm"
            />
          </span>
        )}
        {product.bonusRule && (
          <Badge
            variant="outline"
            className="absolute top-2 right-2 max-w-[calc(100%-1rem)] bg-background/90 font-normal"
          >
            {formatRuleShort(product.bonusRule)}
          </Badge>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-3 text-sm leading-snug">
          <ProductName name={product.name} />
        </p>
        <div className="mt-auto space-y-1">
          <p className="font-semibold tabular-nums">
            {formatYen(product.latestUnitPriceYen)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {product.orderCount > 0
              ? `${product.orderCount}回購入 ・ 計${product.totalQuantity}点`
              : "購入なし"}
            {product.receivedCount > 0 && ` ・ おまけ ${product.receivedCount}点`}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            最終 {formatDate(product.lastOrderedAt)}
          </p>
        </div>
      </CardContent>
    </>
  );

  const className =
    "relative isolate flex flex-col overflow-hidden p-0 transition-colors hover:border-foreground/20";

  return product.productId !== null ? (
    <Link href={`/products/${product.productId}`} className="contents">
      <Card className={className}>{body}</Card>
    </Link>
  ) : (
    <Card className={className}>{body}</Card>
  );
}
