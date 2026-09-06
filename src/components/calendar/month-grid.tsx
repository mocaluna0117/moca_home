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
import type { CalendarMark, MarkIcon, MarkKind } from "@/lib/calendar-marks";
import { shortLabel } from "@/lib/short-name";
import type { DayMeals, UsualMealRow } from "@/lib/queries-log";
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
export const MARK_ICON: Record<MarkIcon, LucideIcon> = {
  scissors: Scissors,
  stethoscope: Stethoscope,
  pill: Pill,
  syringe: Syringe,
};

/**
 * 種類ごとの色と短い名前。**マスと一覧と凡例が同じ表を見る**ので、
 * 片方だけ色を替えて同じ予定が2通りに見えることが起きない。
 *
 * 色は globals.css のトークン（濃い文字 + 淡い面の対）。無彩色のパレットに
 * 対する2つ目の例外で、--destructive と同じ性格 — 「種類が読めない」を
 * 記号だけで解こうとして失敗したのでここだけ色を入れる。
 *
 * short は mark.label から「の予定」を落としたもの。予定であることは
 * 破線と薄さが言うので、文字で二度言わない。
 */
export const MARK_STYLE: Record<MarkKind, { text: string; bg: string; short: string }> = {
  trimming: {
    text: "text-mark-trimming",
    bg: "bg-mark-trimming-soft",
    short: "トリミング",
  },
  hospital: {
    text: "text-mark-hospital",
    bg: "bg-mark-hospital-soft",
    short: "通院",
  },
  heartworm: {
    text: "text-mark-heartworm",
    bg: "bg-mark-heartworm-soft",
    short: "フィラリア",
  },
  vaccination: {
    text: "text-mark-vaccination",
    bg: "bg-mark-vaccination-soft",
    short: "ワクチン",
  },
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
  usual,
}: {
  grid: MonthGrid;
  data: Map<DateStr, DayCellData>;
  today: DateStr;
  /**
   * 登録済みの「いつものご飯」。42マスすべてが同じ1つの配列を参照する
   * （DayCellData に入れて日ごとに複製しない — 中身は日付に依らない）。
   */
  usual: UsualMealRow[];
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
              {/* 日にちの行。印は下の行に分ける（すぐ下のコメント参照） */}
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    isToday
                      ? // 反転した丸バッジ。差し色のピンクで今日を示す
                        "inline-flex size-5 items-center justify-center rounded-full bg-brand-pink font-semibold text-background"
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
              </div>

              {/*
                印の行。**日にちと同じ行に混ぜない** — 混ぜると1つ目だけが
                日にちの幅ぶん右にずれ、2つ目から左端に折り返して段違いに見える。
                印は**種類ごとに1つではなく件数ぶん**並ぶ（同じ日に2本接種する・
                予定が2件重なる、が起こりうる）。上限は無いので flex-wrap で折る
                — 横には溢れさせない。折り返しが増えればこの週の行が
                min-h-28 を超えて伸びる。（高さを抑えたくなったら、順序は
                固定なので marks.slice(0, 6) ＋「＋N」で安全に切れる）

                印が無い日はこの行ごと描かない（空の隙間を作らない）。

                印は MealDayDialog のトリガーの**外**に置く。中に入れると
                ボタンの中にリンクが入り、押した先が2つある要素になる。
              */}
              {d && d.marks.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {d.marks.map((mark) => {
                  const Icon = MARK_ICON[mark.icon];
                  const style = MARK_STYLE[mark.kind];
                  // 読み上げにはラベル（「〜の予定」つき）と薬名・ワクチン名まで。
                  // 同じ日に2本接種した記録が同名・同リンクで並ぶと区別が付かない
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
                        // 記号だけでは「通院かワクチンか」が読めなかったので、
                        // 色つきの小さなチップに種類名まで入れる
                        "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none transition-opacity hover:opacity-80",
                        style.text,
                        // 予定はまだ起きていない。破線＋薄い面で「記録」と見分ける
                        // （文字では言わない — ラベルがすでに「〜の予定」）
                        mark.state === "planned"
                          ? "border border-dashed border-current bg-transparent opacity-80"
                          : style.bg,
                      )}
                    >
                      <Icon className="size-2.5 shrink-0" aria-hidden="true" />
                      {style.short}
                    </Link>
                  );
                  })}
                </div>
              )}

              {d && (
                <MealDayDialog
                  draft={d.draft}
                  previousDate={d.previousDate}
                  usual={usual}
                  triggerVariant="ghost"
                  /*
                    size="sm" は h-7（28px）固定。3食そろった日は中身が 64px に
                    なり、items-center のぶん上下に18pxずつはみ出して、上は
                    日にち・印の行にかぶっていた。h-auto で中身に合わせ、
                    mt-auto でマスの一番下へ落とす（セルは flex flex-col）。
                    min-h-7 は記録の無い日の「＋」の当たり判定を28px残すため。
                    px-1 は sm の px-2.5 だと文字が日にちより右にずれるため。
                  */
                  triggerClassName="mt-auto h-auto min-h-7 px-1 py-0.5 whitespace-normal"
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
                            {/* 行の高さを隣の 11px と揃える。指定しないと
                                ボタンの text-sm 由来の 20px を継いで、
                                13.75px の文字が20pxの行になる */}
                            <span className="shrink-0 text-[10px] leading-tight text-muted-foreground">
                              {SLOT_LABEL[slot]}
                            </span>
                            <span className="truncate text-[11px] leading-tight">
                              {shortLabel(items[0].label, 10, items[0].registeredShortName)}
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
  usual,
}: {
  grid: MonthGrid;
  data: Map<DateStr, DayCellData>;
  today: DateStr;
  /** 登録済みの「いつものご飯」（MonthGridView と同じものを受ける） */
  usual: UsualMealRow[];
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
              <span className="rounded-full bg-brand-pink px-2 py-0.5 text-[10px] font-medium text-background">
                今日
              </span>
            )}
            <div className="ml-auto">
              <MealDayDialog
                draft={d.draft}
                previousDate={d.previousDate}
                usual={usual}
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
                  const style = MARK_STYLE[mark.kind];
                  const planned = mark.state === "planned";
                  return (
                    <li key={mark.key}>
                      <Link
                        href={mark.href}
                        className="-mx-1 flex items-baseline gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/50"
                      >
                        {/* マスと同じ色。幅があるので種類名は下の span が出す */}
                        <Icon
                          className={cn(
                            "size-3.5 shrink-0 translate-y-0.5",
                            style.text,
                            planned && "opacity-70",
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
                            style.text,
                            planned && "opacity-80",
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
                        {items
                          .map((i) => shortLabel(i.label, 16, i.registeredShortName))
                          .join("、")}
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
