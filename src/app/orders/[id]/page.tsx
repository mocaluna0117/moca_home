import { ArrowLeft, ExternalLink, Gift } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  BonusBadge,
  formatBonusSummary,
  formatRuleShort,
} from "@/components/bonus-badge";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { ReceivedBonusSection } from "@/components/received-bonus-section";
import { StatusBadge } from "@/components/status-badge";
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
import { getCatalogState, getOrder } from "@/lib/queries";
import { formatDateTime, formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

const SHOP_ORIGIN = "https://20and20.pet/store";

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  const itemTotal = order.items.reduce((n, i) => n + i.quantity, 0);
  const hasActuals = order.receivedTotal > 0 || order.receivedBonuses.length > 0;
  const catalogState = await getCatalogState();
  const hasPrediction =
    order.bonuses.totalBonusCount > 0 || order.bonuses.gifts.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        購入履歴に戻る
      </Link>

      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold tabular-nums">注文 {order.id}</h1>
        <StatusBadge status={order.status} />
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatDateTime(order.orderedAt)}
        </span>
      </header>

      <section>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[72px]">画像</TableHead>
                <TableHead>商品名</TableHead>
                <TableHead className="text-right">単価</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">小計</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="relative size-12 overflow-hidden rounded border bg-muted">
                      <ImageWithFallback
                        src={item.imageUrl}
                        alt={item.productName}
                        sizes="48px"
                        className="size-full"
                        iconClassName="size-4"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    {item.productId !== null ? (
                      <Link
                        href={`/products/${item.productId}`}
                        className="text-sm leading-snug hover:underline"
                      >
                        {item.productName}
                      </Link>
                    ) : (
                      <span className="text-sm leading-snug">
                        {item.productName}
                      </span>
                    )}
                    {item.bonus.activated && !item.bonus.pooled && (
                      <div className="mt-1">
                        <BonusBadge item={item.bonus} />
                      </div>
                    )}
                    {item.bonus.activated && item.bonus.pooled && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        合算特典対象（{item.bonus.poolFamily ?? "合算"}）
                      </p>
                    )}
                    {item.bonus.rule &&
                      item.bonus.rule.kind !== "included" &&
                      !item.bonus.activated && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          特典 {formatRuleShort(item.bonus.rule)}
                          （この注文では未適用）
                        </p>
                      )}
                    {item.bonus.hint === "maybe-poolable" && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        合算対象の可能性あり
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatYen(item.unitPriceYen)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatYen(item.unitPriceYen * item.quantity)}
                  </TableCell>
                </TableRow>
              ))}
              {order.receivedBonuses.map((r) => (
                <TableRow key={`received-${r.id}`} className="text-muted-foreground">
                  <TableCell>
                    <div className="relative size-12 overflow-hidden rounded border bg-muted">
                      {r.productId !== null ? (
                        <ImageWithFallback
                          src={r.imageUrl}
                          alt={r.label}
                          sizes="48px"
                          className="size-full"
                          iconClassName="size-4"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center">
                          <Gift className="size-4" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    {r.productId !== null ? (
                      <Link
                        href={`/products/${r.productId}`}
                        className="text-sm leading-snug hover:underline"
                      >
                        {r.label}
                      </Link>
                    ) : (
                      <span className="text-sm leading-snug">{r.label}</span>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="font-normal">
                        <Gift aria-hidden="true" />
                        おまけ
                      </Badge>
                      {r.note && (
                        <span className="text-xs text-muted-foreground">
                          {r.note}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">—</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.quantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">—</TableCell>
                </TableRow>
              ))}
              {!hasActuals && order.bonuses.gifts.map((g, i) => (
                <TableRow key={`gift-${i}`} className="text-muted-foreground">
                  <TableCell>
                    <div className="flex size-12 items-center justify-center rounded border bg-muted">
                      <Gift className="size-4" aria-hidden="true" />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-md text-sm leading-snug whitespace-normal">
                    {g.label}（プレゼント）
                  </TableCell>
                  <TableCell className="text-right tabular-nums">—</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.count}
                    {g.unit ?? ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">—</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          {order.items.length}種 / 合計{itemTotal}点
        </p>
      </section>

      <ReceivedBonusSection order={order} catalogSynced={catalogState.count > 100} />

      <section className="flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5 text-sm">
          <Row label="小計" value={formatYen(order.subtotalYen)} />
          <Row label="手数料" value={formatYen(order.feeYen)} />
          <Row label="送料" value={formatYen(order.shippingFeeYen)} />
          {hasActuals ? (
            <>
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">届いたおまけ</dt>
                <dd className="inline-flex items-center gap-1 tabular-nums">
                  <Gift
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {order.receivedTotal}点
                </dd>
              </div>
              {hasPrediction && (
                <p className="text-right text-xs text-muted-foreground">
                  予測: {formatBonusSummary(order.bonuses)}
                </p>
              )}
            </>
          ) : (
            hasPrediction && (
              <div className="flex items-baseline justify-between">
                <dt className="text-muted-foreground">特典（予測）</dt>
                <dd className="inline-flex items-center gap-1 tabular-nums">
                  <Gift
                    className="size-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  {formatBonusSummary(order.bonuses)}
                </dd>
              </div>
            )
          )}
          <Separator className="my-2" />
          <div className="flex items-baseline justify-between">
            <dt className="font-medium">合計</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatYen(order.totalYen)}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                税込
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {order.shippingMethod && (
        <section className="text-sm">
          <span className="text-muted-foreground">配送方法: </span>
          {order.shippingMethod}
        </section>
      )}

      <a
        href={`${SHOP_ORIGIN}/mypage/history/${order.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        ショップで注文を見る
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
