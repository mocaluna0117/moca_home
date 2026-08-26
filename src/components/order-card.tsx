import Link from "next/link";

import { ImageWithFallback } from "@/components/image-with-fallback";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { OrderWithItems } from "@/lib/queries";
import { formatDate, formatYen } from "@/lib/format";

const MAX_VISIBLE_ITEMS = 4;

export function OrderCard({ order }: { order: OrderWithItems }) {
  const visible = order.items.slice(0, MAX_VISIBLE_ITEMS);
  const hidden = order.items.length - visible.length;
  const itemTotal = order.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <Card className="transition-colors hover:border-foreground/20">
      <CardHeader className="gap-2 pb-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/orders/${order.id}`}
            className="font-medium tabular-nums hover:underline"
          >
            {formatDate(order.orderedAt)}
          </Link>
          <span className="text-xs text-muted-foreground tabular-nums">
            注文番号 {order.id}
          </span>
          <StatusBadge status={order.status} />
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
              <div className="relative size-16 shrink-0 overflow-hidden rounded-md border bg-muted">
                <ImageWithFallback
                  src={item.imageUrl}
                  alt={item.productName}
                  sizes="64px"
                  className="size-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                {item.productId !== null ? (
                  <Link
                    href={`/products/${item.productId}`}
                    className="line-clamp-2 text-sm leading-snug hover:underline"
                  >
                    {item.productName}
                  </Link>
                ) : (
                  <p className="line-clamp-2 text-sm leading-snug">
                    {item.productName}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatYen(item.unitPriceYen)} × {item.quantity}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <Link
            href={`/orders/${order.id}`}
            className="mt-3 inline-block text-xs text-muted-foreground hover:underline"
          >
            他 {hidden} 点を表示
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
