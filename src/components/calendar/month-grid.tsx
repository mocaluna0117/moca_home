import { Syringe } from "lucide-react";

import { MealDayDialog, type DayDraft } from "@/components/calendar/meal-day-dialog";
import {
  MEAL_SLOTS,
  SLOT_LABEL,
  weekdayLabel,
  type DateStr,
  type MonthGrid,
} from "@/lib/calendar";
import { shortLabel } from "@/lib/short-name";
import type { DayMeals } from "@/lib/queries-log";
import { cn } from "@/lib/utils";

export interface DayCellData {
  meals: DayMeals | null;
  draft: DayDraft;
  previousDate: DateStr | null;
  vaccines: string[];
}

/**
 * 月グリッド（デスクトップ）。セルは <div> で、中のスロット行がそれぞれ
 * 押せるボタンになる。react-day-picker はセル自体が <button> なので
 * この形が作れず、かつグリッド全体がクライアントに落ちるため使わない。
 * ここは RSC のまま = JS ゼロで描かれる。
 */
export function MonthGridView({
  grid,
  data,
  today,
}: {
  grid: MonthGrid;
  data: Map<DateStr, DayCellData>;
  today: DateStr;
}) {
  return (
    <div className="hidden overflow-hidden rounded-lg border md:block">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {[0, 1, 2, 3, 4, 5, 6].map((w) => (
          <div
            key={w}
            className={cn(
              "px-2 py-1.5 text-center text-xs font-medium",
              w === 0 && "text-destructive",
              w !== 0 && "text-muted-foreground",
            )}
          >
            {weekdayLabel(w)}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.weeks.flat().map((cell) => {
          const d = data.get(cell.date);
          const isToday = cell.date === today;
          return (
            <div
              key={cell.date}
              className={cn(
                "relative flex min-h-28 flex-col gap-1 border-r border-b p-1.5 last:border-r-0",
                !cell.inMonth && "bg-muted/30",
                // --accent はほぼ白なので、今日は枠線で示す（無彩色パレットで
                // 背景だけだと視認できない）
                isToday && "bg-accent ring-2 ring-foreground/70 ring-inset",
              )}
            >
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    isToday
                      ? // 反転した丸バッジ。色を使わずに一目で分かる
                        "inline-flex size-5 items-center justify-center rounded-full bg-foreground font-semibold text-background"
                      : [
                          !cell.inMonth && "text-muted-foreground/50",
                          cell.inMonth && cell.weekday === 0 && "text-destructive",
                          cell.inMonth &&
                            cell.weekday !== 0 &&
                            "text-muted-foreground",
                        ],
                  )}
                >
                  {cell.day}
                </span>
                {isToday && (
                  <span className="text-[10px] font-medium text-foreground">
                    今日
                  </span>
                )}
                {d && d.vaccines.length > 0 && (
                  <Syringe
                    className="size-3 text-muted-foreground"
                    aria-label="接種記録あり"
                  />
                )}
              </div>

              {d && (
                <MealDayDialog
                  draft={d.draft}
                  previousDate={d.previousDate}
                  triggerVariant="ghost"
                  trigger={
                    <span className="flex w-full flex-col items-start gap-0.5">
                      {MEAL_SLOTS.map((slot) => {
                        const items = d.meals?.[slot] ?? [];
                        if (items.length === 0) return null;
                        return (
                          <span
                            key={slot}
                            className="flex w-full items-baseline gap-1 text-left"
                          >
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {SLOT_LABEL[slot]}
                            </span>
                            <span className="truncate text-[11px] leading-tight">
                              {shortLabel(items[0].label, 10)}
                              {items.length > 1 && `他${items.length - 1}`}
                            </span>
                          </span>
                        );
                      })}
                      {(!d.meals || d.meals.total === 0) && (
                        <span className="text-[11px] text-muted-foreground/60">
                          ＋
                        </span>
                      )}
                    </span>
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * モバイル（〜767px）。7列に商品名は入らないので、記録のある日を
 * リストで並べる。横スクロールは作らない。
 */
export function MonthAgendaView({
  grid,
  data,
  today,
}: {
  grid: MonthGrid;
  data: Map<DateStr, DayCellData>;
  today: DateStr;
}) {
  const days = grid.weeks
    .flat()
    .filter((c) => c.inMonth)
    .map((c) => ({ cell: c, d: data.get(c.date) }))
    .filter((x): x is { cell: (typeof grid.weeks)[0][0]; d: DayCellData } =>
      Boolean(x.d),
    );

  const withRecords = days.filter(
    (x) => (x.d.meals?.total ?? 0) > 0 || x.d.vaccines.length > 0,
  );

  return (
    <div className="flex flex-col gap-2 md:hidden">
      {withRecords.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            この月の記録はまだありません
          </p>
        </div>
      )}
      {withRecords.map(({ cell, d }) => (
        <div
          key={cell.date}
          className={cn(
            "rounded-lg border p-3",
            cell.date === today && "ring-2 ring-foreground/70 ring-inset",
          )}
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium tabular-nums",
                cell.date !== today && cell.weekday === 0 && "text-destructive",
              )}
            >
              {cell.day}日（{weekdayLabel(cell.weekday)}）
            </span>
            {cell.date === today && (
              <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-medium text-background">
                今日
              </span>
            )}
            {d.vaccines.length > 0 && (
              <Syringe className="size-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <div className="ml-auto">
              <MealDayDialog
                draft={d.draft}
                previousDate={d.previousDate}
                triggerVariant="ghost"
                trigger="編集"
              />
            </div>
          </div>
          <ul className="flex flex-col gap-1">
            {MEAL_SLOTS.map((slot) => {
              const items = d.meals?.[slot] ?? [];
              if (items.length === 0) return null;
              return (
                <li key={slot} className="flex gap-2 text-sm">
                  <span className="w-10 shrink-0 text-xs text-muted-foreground">
                    {SLOT_LABEL[slot]}
                  </span>
                  <span className="flex-1 leading-snug">
                    {items.map((i) => shortLabel(i.label, 16)).join("、")}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
