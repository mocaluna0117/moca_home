import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import type { MonthGrid } from "@/lib/calendar";

/** 月の移動は <Link>。戻るで辿れて URL を共有できる。 */
export function MonthNav({
  grid,
  tab,
  thisMonth,
}: {
  grid: MonthGrid;
  tab: string;
  thisMonth: string;
}) {
  const href = (m: string) =>
    `/calendar?m=${m}${tab !== "log" ? `&tab=${tab}` : ""}`;

  return (
    <div className="flex items-center gap-2">
      <Link
        href={href(grid.prev)}
        scroll={false}
        aria-label="前の月"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <ChevronLeft />
      </Link>
      <h1 className="font-heading min-w-32 text-center text-lg font-semibold tabular-nums">
        {grid.label}
      </h1>
      <Link
        href={href(grid.next)}
        scroll={false}
        aria-label="次の月"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <ChevronRight />
      </Link>
      {grid.ym !== thisMonth && (
        <Link
          href={href(thisMonth)}
          scroll={false}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          今月
        </Link>
      )}
    </div>
  );
}
