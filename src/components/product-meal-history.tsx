import { ArrowRight, UtensilsCrossed } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { SLOT_LABEL } from "@/lib/calendar";
import { formatDate } from "@/lib/format";
import type { ProductMealSummary } from "@/lib/queries-log";

/** /products/[id] の「食べた記録」。「いつから食べているか」に答える。 */
export function ProductMealHistory({ meal }: { meal: ProductMealSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
        <UtensilsCrossed className="size-4" aria-hidden="true" />
        食べた記録
      </h2>

      {meal.entryCount === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            この商品を食べた記録はまだありません
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            カレンダーで朝・夜・おやつを記録すると、いつから食べているかがここに出ます。
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm tabular-nums">
            <span className="font-semibold">{formatDate(meal.firstDate)}</span> から
            <span className="font-semibold"> {meal.dayCount}日</span>
            <span className="text-muted-foreground">
              （{SLOT_LABEL.morning}
              {meal.slots.morning}・{SLOT_LABEL.evening}
              {meal.slots.evening}・{SLOT_LABEL.treat}
              {meal.slots.treat}）
            </span>
          </p>
          {meal.lastDate && (
            <p className="text-xs text-muted-foreground tabular-nums">
              最後に食べたのは {formatDate(meal.lastDate)}
              {meal.lastSlot && `（${SLOT_LABEL[meal.lastSlot]}）`}
            </p>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {meal.recent.map((r) => (
              <li key={r.id}>
                <Badge variant="outline" className="font-normal tabular-nums">
                  {formatDate(r.date)} {SLOT_LABEL[r.slot]}
                </Badge>
              </li>
            ))}
          </ul>
          {meal.firstDate && (
            <Link
              href={`/calendar?m=${meal.firstDate.slice(0, 7)}`}
              className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              カレンダーで見る
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </section>
  );
}
