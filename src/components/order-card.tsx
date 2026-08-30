import { Gift } from "lucide-react";
import Link from "next/link";

import { BonusBadge, formatBonusSummary } from "@/components/bonus-badge";
import { FavoriteButton } from "@/components/favorite-button";
import { ProductName } from "@/components/product-name";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { ReceivedBonusDialog } from "@/components/received-bonus-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { OrderWithItems } from "@/lib/queries";
import { formatDate, formatYen } from "@/lib/format";
import { buildReceivedDrafts } from "@/lib/received-draft";

const MAX_VISIBLE_ITEMS = 4;

export function OrderCard({
  order,
  catalogSynced,
  favoriteIds,
}: {
  order: OrderWithItems;
  catalogSynced: boolean;
  /** 星がついた商品ID。ページ側で1回だけ引いて配る */
  favoriteIds: Set<number>;
}) {
  const visible = order.items.slice(0, MAX_VISIBLE_ITEMS);
  const hidden = order.items.length - visible.length;
  const itemTotal = order.items.reduce((n, i) => n + i.quantity, 0);
  const { existing, predicted } = buildReceivedDrafts(order);

  return (
    // Stretched-link pattern: one overlay link makes the whole card open the
    // order, while the product links inside stay clickable via z-10 (nesting
    // real <a>s would be invalid HTML).
    // `isolate` keeps the card's internal z-10/z-20 layering inside the card.
    // Without it those children share the page stacking context with the
    // sticky header (also z-20) and, being later in the DOM, scroll over it.
    <Card className="relative isolate cursor-pointer transition-colors hover:border-foreground/20 hover:bg-muted/30 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <Link
        href={`/orders/${order.id}`}
        aria-label={`注文 ${order.id}（${formatDate(order.orderedAt)}）の詳細`}
        // z-10 clears the positioned thumbnail wrappers; the few elements that
        // must stay interactive sit at z-20.
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none"
      />
      <CardHeader className="gap-2 pb-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium tabular-nums">
            {formatDate(order.orderedAt)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            注文番号 {order.id}
          </span>
          <StatusBadge status={order.status} />
          {order.receivedTotal > 0 ? (
            <Badge variant="secondary" className="shrink-0 font-normal">
              <Gift aria-hidden="true" />
              届いたおまけ {order.receivedTotal}点
            </Badge>
          ) : (
            (order.bonuses.totalBonusCount > 0 ||
              order.bonuses.gifts.length > 0) && (
              <Badge variant="secondary" className="shrink-0 font-normal">
                <Gift aria-hidden="true" />
                {formatBonusSummary(order.bonuses)}
              </Badge>
            )
          )}
          <div className="ml-auto text-right">
            <div className="font-semibold tabular-nums">
              {formatYen(order.totalYen)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {order.items.length}種 / {itemTotal}点
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ul className="flex flex-col gap-3">
          {visible.map((item) => (
            <li key={item.id} className="flex items-start gap-3">
              <div className="relative size-20 shrink-0 overflow-hidden rounded-md border bg-muted sm:size-24">
                <ImageWithFallback
                  src={item.imageUrl}
                  alt={item.productName}
                  sizes="(min-width: 640px) 96px, 80px"
                  className="size-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                {item.productId !== null ? (
                  <Link
                    href={`/products/${item.productId}`}
                    className="relative z-20 line-clamp-3 text-sm leading-snug hover:underline"
                  >
                    <ProductName name={item.productName} />
                  </Link>
                ) : (
                  <p className="line-clamp-3 text-sm leading-snug">
                    <ProductName name={item.productName} />
                  </p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                  {formatYen(item.unitPriceYen)} × {item.quantity}
                  {item.productId !== null && (
                    <span className="relative z-20 inline-flex">
                      <FavoriteButton
                        productId={item.productId}
                        isFavorite={favoriteIds.has(item.productId)}
                        size="sm"
                      />
                    </span>
                  )}
                  {item.bonus.activated && !item.bonus.pooled && (
                    // z-20 keeps the badge's title tooltip reachable above the
                    // card-wide link.
                    <span className="relative z-20 inline-flex">
                      <BonusBadge item={item.bonus} />
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
          {order.receivedBonuses.map((r, i) => (
            <li
              key={`received-${r.id}`}
              // Only the first freebie gets a rule — it marks where the
              // purchased items end; the rest read as one continuous list.
              className={
                i === 0
                  ? "flex items-start gap-3 border-t pt-3"
                  : "flex items-start gap-3"
              }
            >
              <div className="relative size-20 shrink-0 overflow-hidden rounded-md border bg-muted sm:size-24">
                {r.productId !== null ? (
                  <ImageWithFallback
                    src={r.imageUrl}
                    alt={r.label}
                    sizes="(min-width: 640px) 96px, 80px"
                    className="size-full"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Gift
                      className="size-6 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {r.productId !== null ? (
                  <Link
                    href={`/products/${r.productId}`}
                    className="relative z-20 line-clamp-3 text-sm leading-snug hover:underline"
                  >
                    <ProductName name={r.label} />
                  </Link>
                ) : (
                  <p className="line-clamp-3 text-sm leading-snug">
                    <ProductName name={r.label} />
                  </p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                  <Badge variant="secondary" className="font-normal">
                    <Gift aria-hidden="true" />
                    おまけ
                  </Badge>
                  ×{r.quantity}
                  {r.productId !== null && (
                    <span className="relative z-20 inline-flex">
                      <FavoriteButton
                        productId={r.productId}
                        isFavorite={favoriteIds.has(r.productId)}
                        size="sm"
                      />
                    </span>
                  )}
                  {r.note && <span>・{r.note}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {order.receivedTotal === 0 && order.bonuses.pools
          .filter(
            (p) =>
              p.activated &&
              p.memberIndexes.length + p.contributorIndexes.length > 1,
          )
          .map((p) => (
            <p
              key={p.poolKey}
              className="mt-2 text-xs text-muted-foreground tabular-nums"
            >
              {p.family ?? "合算"}合算 {p.totalQuantity}コ →{" "}
              {p.ruleKind === "gift"
                ? `${p.giftLabel}プレゼント`
                : `おまけ +${p.bonusCount}コ`}
            </p>
          ))}
        <div className="mt-3 flex items-center justify-between gap-2">
          {hidden > 0 ? (
            // Plain text — the whole card already opens the order.
            <p className="text-xs text-muted-foreground">他 {hidden} 点を表示</p>
          ) : (
            <span />
          )}
          {/* z-20 lifts the trigger above the card-wide link. */}
          <span className="relative z-20 shrink-0">
            <ReceivedBonusDialog
              orderId={order.id}
              existing={existing}
              predicted={predicted}
              catalogSynced={catalogSynced}
              trigger={order.receivedBonuses.length > 0 ? "おまけを編集" : "おまけを記録"}
              triggerVariant="ghost"
            />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
