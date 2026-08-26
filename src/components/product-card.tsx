import Link from "next/link";

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
        {product.fetchStatus === "not_found" && (
          <Badge
            variant="outline"
            className="absolute top-2 left-2 bg-background/90 font-normal"
          >
            販売終了
          </Badge>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-3 text-sm leading-snug">{product.name}</p>
        <div className="mt-auto space-y-1">
          <p className="font-semibold tabular-nums">
            {formatYen(product.latestUnitPriceYen)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {product.orderCount}回購入 ・ 計{product.totalQuantity}点
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            最終 {formatDate(product.lastOrderedAt)}
          </p>
        </div>
      </CardContent>
    </>
  );

  const className =
    "flex flex-col overflow-hidden p-0 transition-colors hover:border-foreground/20";

  return product.productId !== null ? (
    <Link href={`/products/${product.productId}`} className="contents">
      <Card className={className}>{body}</Card>
    </Link>
  ) : (
    <Card className={className}>{body}</Card>
  );
}
