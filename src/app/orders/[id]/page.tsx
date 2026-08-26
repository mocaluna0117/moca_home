import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ImageWithFallback } from "@/components/image-with-fallback";
import { StatusBadge } from "@/components/status-badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getOrder } from "@/lib/queries";
import { formatDateTime, formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

const SHOP_ORIGIN = "https://20and20.pet/store";

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const order = getOrder(id);
  if (!order) notFound();

  const itemTotal = order.items.reduce((n, i) => n + i.quantity, 0);

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
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          {order.items.length}種 / 合計{itemTotal}点
        </p>
      </section>

      <section className="flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5 text-sm">
          <Row label="小計" value={formatYen(order.subtotalYen)} />
          <Row label="手数料" value={formatYen(order.feeYen)} />
          <Row label="送料" value={formatYen(order.shippingFeeYen)} />
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
