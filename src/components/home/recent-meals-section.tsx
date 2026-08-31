import Link from "next/link";
import { ChevronRight, UtensilsCrossed } from "lucide-react";

import { formatDayLabel } from "@/lib/calendar";
import type { HomeRecentDay } from "@/lib/queries-home";
import { cn } from "@/lib/utils";

/**
 * 【3】最近のごはん。**今日は入っていない**（今日はヒーローが持つ）。
 *
 * days は queries-home が「today より前で記録のある直近3日」に絞り、
 * 各日の lines も記録のあるスロットだけに絞ってある。空の日を混ぜない・
 * ダミーで3枚に埋めないのは、埋まっている枚数がそのまま記録の量に見える方が
 * 正直だから。
 *
 * ここに MealDayDialog は置かない。入力の入口はページに1つ（ヒーローの
 * 「今日を記録」）だけにして、同じ下書きを2箇所から編集できる状態を作らない。
 */
export function RecentMealsSection({ days }: { days: HomeRecentDay[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
          <UtensilsCrossed className="size-4" aria-hidden="true" />
          最近のごはん
        </h2>
        <Link
          href="/calendar"
          className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          カレンダーへ
          <ChevronRight className="size-3" aria-hidden="true" />
        </Link>
      </div>

      {days.length === 0 ? (
        /*
          ケアは埋まっているがごはんだけ空、という状態。ダイアログを
          もう1つ置く代わりに、上の「今日を記録」を言葉で指す。
        */
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだごはんの記録がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            上の「今日を記録」から、朝・夜・おやつを登録できます。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:gap-3">
          {days.map((day) => (
            <div key={day.date} className="rounded-lg border p-3">
              <p className="text-sm tabular-nums">
                {formatDayLabel(day.date)}
                {/* 相対表記は前日だけ。2日前まで言うと日付が2つの読み方を持つ */}
                {day.relative !== null && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {day.relative}
                  </span>
                )}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {day.lines.map((line) => (
                  <li key={line.slot} className="flex gap-2 text-sm">
                    {/* w-10 は MonthAgendaView のラベル列と同じ幅（縦に揃う） */}
                    <span className="w-10 shrink-0 text-xs text-muted-foreground">
                      {line.label}
                    </span>
                    {/* 記録のある行しか来ないが、empty を無視せず contract 通り扱う */}
                    <span
                      className={cn(
                        "min-w-0 flex-1 line-clamp-1 leading-snug",
                        line.empty && "text-muted-foreground",
                      )}
                    >
                      {line.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
