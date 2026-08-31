import { Pill, Scissors, Stethoscope, Syringe, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { MealDayDialog, type DayDraft } from "@/components/calendar/meal-day-dialog";
import {
  MEAL_SLOTS,
  SLOT_LABEL,
  weekdayLabel,
  type DateStr,
  type MonthGrid,
} from "@/lib/calendar";
import type { CalendarMark, MarkIcon } from "@/lib/calendar-marks";
import { shortLabel } from "@/lib/short-name";
import type { DayMeals } from "@/lib/queries-log";
import { cn } from "@/lib/utils";

export interface DayCellData {
  meals: DayMeals | null;
  draft: DayDraft;
  previousDate: DateStr | null;
  /** トリミング・通院・フィラリア・ワクチン（記録も予定も）。空なら印なし */
  marks: CalendarMark[];
}

/**
 * 記号の対応表はこの1箇所だけ。マスとアジェンダで別々に書くと、
 * 片方だけアイコンを差し替えた日に同じ予定が2つの記号で出てしまう。
 */
const MARK_ICON: Record<MarkIcon, LucideIcon> = {
  scissors: Scissors,
  stethoscope: Stethoscope,
  pill: Pill,
  syringe: Syringe,
};

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
              {/*
                日にちと印の行。印は**種類ごとに1つではなく件数ぶん**並ぶ
                （同じ日に2本接種する・予定が2件重なる、が起こりうる）。
                上限は無いので flex-wrap で折る — 横には溢れさせない。
                7つ目からはこの週の行が min-h-28 を超えて伸びる。
                （高さを抑えたくなったら、順序は固定なので
                  marks.slice(0, 6) ＋「＋N」で安全に切れる）
              */}
              <div className="flex flex-wrap items-center gap-1">
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
                {/*
                  印は MealDayDialog のトリガーの**外**に置く。中に入れると
                  ボタンの中にリンクが入り、押した先が2つある要素になる。
                */}
                {d?.marks.map((mark) => {
                  const Icon = MARK_ICON[mark.icon];
                  // 記号だけでは名前にならないので、ラベルを読み上げに回す。
                  // 薬名・ワクチン名まで足すのは、同じ日に2本接種した記録が
                  // 「ワクチン」「ワクチン」と同名・同リンクで2つ並び、
                  // 読み上げでも操作でも区別が付かなくなるため。
                  const name =
                    mark.detail === null
                      ? mark.label
                      : `${mark.label} ${mark.detail}`;
                  return (
                    <Link
                      key={mark.key}
                      href={mark.href}
                      aria-label={name}
                      title={name}
                      className={cn(
                        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                        // 予定はまだ起きていない。破線の枠で「記録」と見分ける
                        // （文字では言わない — ラベルがすでに「〜の予定」）
                        mark.state === "planned" &&
                          "border border-dashed border-muted-foreground/60",
                      )}
                    >
                      <Icon className="size-3" aria-hidden="true" />
                    </Link>
                  );
                })}
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
 *
 * 飼い主がふだん見るのはこの表示なので、**印だけの日も必ず残す**
 * （トリミングしか無い日が電話から消えると、記録した意味が無い）。
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
    (x) => (x.d.meals?.total ?? 0) > 0 || x.d.marks.length > 0,
  );

  return (
    <div className="flex flex-col gap-2 md:hidden">
      {withRecords.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          {/* 予定の印も並ぶ場所になったので、「記録が無い」だけでは足りない */}
          <p className="text-sm text-muted-foreground">
            この月の記録も予定もまだありません
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
            <div className="ml-auto">
              <MealDayDialog
                draft={d.draft}
                previousDate={d.previousDate}
                triggerVariant="ghost"
                trigger="編集"
              />
            </div>
          </div>
          {/*
            印だけの日・食事だけの日で余白の付き方が変わらないよう、
            2つの一覧はどちらも空なら描かず、間隔は gap に持たせる。
          */}
          <div className="flex flex-col gap-2">
            {d.marks.length > 0 && (
              /*
                マスと違って幅があるので、印は記号ではなく文字の行にする
                （記号だけだと「注射に見えるけどワクチン？フィラリア？」になる）。
                食事より上に置くのは、その日が何の日だったかを先に言うため。
              */
              <ul className="flex flex-col gap-1">
                {d.marks.map((mark) => {
                  const Icon = MARK_ICON[mark.icon];
                  const planned = mark.state === "planned";
                  return (
                    <li key={mark.key}>
                      <Link
                        href={mark.href}
                        className="-mx-1 flex items-baseline gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/50"
                      >
                        <Icon
                          className={cn(
                            "size-3.5 shrink-0 translate-y-0.5",
                            planned
                              ? "text-muted-foreground/70"
                              : "text-muted-foreground",
                          )}
                          aria-hidden="true"
                        />
                        {/*
                          予定は薄い字で。「予定」の札は足さない —
                          ラベルがすでに「〜の予定」なので2回言うことになる
                        */}
                        {/*
                          shrink-0 が要る。付けないと flex が両方を縮め、
                          薬名が長い日に「フィラリアの予」「定」のように
                          種類の名前が途中で折れる（375px で実際に起きる）
                        */}
                        <span
                          className={cn(
                            "shrink-0 text-sm leading-snug",
                            planned && "text-muted-foreground",
                          )}
                        >
                          {mark.label}
                        </span>
                        {/*
                          薬名・ワクチン名。マスには入らないぶんをここで足す。
                          自由入力なので、すぐ下の食事の行と同じ 16 文字で切る
                        */}
                        {mark.detail !== null && (
                          <span className="min-w-0 truncate text-xs leading-snug text-muted-foreground">
                            {shortLabel(mark.detail, 16)}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {(d.meals?.total ?? 0) > 0 && (
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
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
