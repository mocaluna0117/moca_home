import { ArrowLeft, ExternalLink, Gift } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatHistoryBonus,
  formatRuleLong,
} from "@/components/bonus-badge";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { ProductName } from "@/components/product-name";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FavoriteButton } from "@/components/favorite-button";
import { ProductMealHistory } from "@/components/product-meal-history";
import { parseBonusRule } from "@/lib/bonus";
import { getFavoriteProductIds, getProductDetail } from "@/lib/queries";
import { getProductMealSummary } from "@/lib/queries-log";
import { formatDate, formatYen, parseJsonArray } from "@/lib/format";
import { parseIdParam } from "@/lib/route-params";

export const dynamic = "force-dynamic";

const SHOP_ORIGIN = "https://20and20.pet/store";

export default async function ProductPage({
  params,
}: PageProps<"/products/[id]">) {
  const { id } = await params;
  const productId = parseIdParam(id);
  if (productId === null) notFound();

  const [{ product, snapshot, history }, meal, favoriteIds] = await Promise.all([
    getProductDetail(productId),
    getProductMealSummary(productId),
    getFavoriteProductIds(),
  ]);
  if (!product && !snapshot) notFound();

  const isGone = product?.fetchStatus === "not_found";
  // The scraped product page wins when available; the order snapshot is the
  // always-present fallback for delisted items.
  const live = isGone ? null : product;
  const name = live?.name || snapshot?.name || `商品 ${productId}`;
  const priceYen = live?.priceYen ?? snapshot?.unitPriceYen ?? null;
  const images = isGone ? [] : parseJsonArray(product?.imageUrls);
  const heroImage = images[0] ?? snapshot?.imageUrl ?? null;
  const tags = isGone ? [] : parseJsonArray(product?.tags);

  const bonusRule = parseBonusRule(name);
  const totalQuantity = history.reduce((n, h) => n + h.quantity, 0);
  const totalSpent = history.reduce((n, h) => n + h.unitPriceYen * h.quantity, 0);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/?view=products"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        商品一覧に戻る
      </Link>

      <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
          <ImageWithFallback
            src={heroImage}
            alt={name}
            sizes="(min-width: 768px) 18rem, 100vw"
            className="size-full"
            iconClassName="size-10"
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <h1 className="flex-1 text-lg leading-snug font-semibold">
              <ProductName name={name} dim={false} />
            </h1>
            <FavoriteButton
              productId={productId}
              isFavorite={favoriteIds.has(productId)}
            />
          </div>
          <p className="text-xl font-semibold tabular-nums">
            {formatYen(priceYen)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              税込
            </span>
          </p>

          {bonusRule && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="font-normal">
                <Gift aria-hidden="true" />
                {formatRuleLong(bonusRule)}
              </Badge>
              {bonusRule.scope && (
                <span className="text-xs text-muted-foreground">
                  ※ {bonusRule.scope.family}シリーズと同一注文内で合算OK
                </span>
              )}
            </div>
          )}

          {isGone && (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              ※ 販売終了のため、注文履歴に記録された情報のみ表示しています。
            </p>
          )}

          {(product?.category || tags.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {product?.category && !isGone && (
                <Badge variant="outline" className="font-normal">
                  {product.category}
                </Badge>
              )}
              {tags.map((tag) => (
                <Badge key={tag} variant="outline" className="font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="購入回数" value={`${history.length}回`} />
            <Stat label="購入数量" value={`${totalQuantity}点`} />
            <Stat label="支出合計" value={formatYen(totalSpent)} />
            <Stat
              label="食べ始め"
              value={meal.firstDate ? formatDate(meal.firstDate) : "—"}
            />
          </dl>

          <a
            href={`${SHOP_ORIGIN}/products/detail/${productId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            ショップで商品を見る
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      {images.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {images.slice(1).map((src) => (
            <div
              key={src}
              className="relative size-20 overflow-hidden rounded border bg-muted"
            >
              <ImageWithFallback
                src={src}
                alt={name}
                sizes="80px"
                className="size-full"
                iconClassName="size-4"
              />
            </div>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">購入履歴</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>注文日</TableHead>
                <TableHead>注文番号</TableHead>
                <TableHead>状況</TableHead>
                <TableHead className="text-right">単価</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">特典</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={`${h.orderId}-${h.unitPriceYen}-${h.quantity}`}>
                  <TableCell className="tabular-nums">
                    <Link href={`/orders/${h.orderId}`} className="hover:underline">
                      {formatDate(h.orderedAt)}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{h.orderId}</TableCell>
                  <TableCell className="text-muted-foreground">{h.status}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatYen(h.unitPriceYen)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {h.quantity}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {formatHistoryBonus(h.bonus)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <ProductMealHistory meal={meal} />

      {!isGone && product?.descriptionHtml && (
        <section className="flex flex-col gap-3">
          <Separator />
          <h2 className="text-sm font-medium">商品説明</h2>
          <div
            className="text-sm leading-relaxed break-words [&_a]:underline [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full"
            // Sanitized in the scraper's parseProductPage (scripts, event
            // handlers and javascript: URLs are stripped at ingest).
            dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
          />
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
