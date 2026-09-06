import { CalendarDays, Sparkles } from "lucide-react";
import Link from "next/link";

import {
  MonthAgendaView,
  MonthGridView,
  type DayCellData,
} from "@/components/calendar/month-grid";
import { MarkLegend } from "@/components/calendar/mark-legend";
import { MealDayDialog, type DayDraft } from "@/components/calendar/meal-day-dialog";
import { MonthNav } from "@/components/calendar/month-nav";
import { Badge } from "@/components/ui/badge";
import {
  buildMonthGrid,
  monthRange,
  parseYearMonth,
  todayJst,
  yearMonthOf,
  type DateStr,
} from "@/lib/calendar";
import { buildCalendarMarks } from "@/lib/calendar-marks";
import { formatDate, nowJstIso } from "@/lib/format";
import { shortLabel } from "@/lib/short-name";
import { getCareDates, getHeartwormDoses } from "@/lib/queries-care";
import {
  getMealDay,
  getMealMonth,
  getPreviousSlot,
  getStartedInMonth,
  getUsualMeals,
  getVaccinationDates,
  getVaccinationSchedule,
  type DayMeals,
} from "@/lib/queries-log";

export const dynamic = "force-dynamic";

function toDraft(date: DateStr, meals: DayMeals | null): DayDraft {
  const map = (rows: DayMeals["morning"]) =>
    rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      label: r.label,
      amountValue: r.amountValue,
      amountUnit: r.amountUnit,
      amount: r.amount,
      note: r.note,
      imageUrl: r.imageUrl,
    }));
  return {
    date,
    morning: meals ? map(meals.morning) : [],
    evening: meals ? map(meals.evening) : [],
    treat: meals ? map(meals.treat) : [],
  };
}

/**
 * カレンダー。**月グリッド1枚だけ**のページ。
 *
 * かつてここに4つのタブ（記録・いつもの・食べたもの・接種記録）が乗って
 * いたが、いつもの／食べたものは「ごはん」(/meals)、接種記録は
 * 「接種記録」(/vaccinations) に移した。どれもヘッダーから直接開けるように
 * なり、このページは「その日に何があったか」だけを答える。
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const rawM = Array.isArray(params.m) ? params.m[0] : params.m;

  const today = todayJst(nowJstIso());
  const thisMonth = yearMonthOf(today);
  // 不正な ?m= は 404 にせず今月へフォールバックする
  const ym = parseYearMonth(rawM) ?? thisMonth;
  const grid = buildMonthGrid(ym)!;
  // ym は parseYearMonth を通っているので monthRange も必ず返る
  const range = monthRange(ym)!;

  /*
    印の材料はすべて既存のクエリから引く。**カレンダー専用のクエリは足さない**
    — 「その日に何があったか」の答えが2箇所に増えると、片方だけ直る日が来る。

    getUsualMeals はダイアログの「いつものご飯を追加」に渡すぶん。登録は
    高々20行で、42マスすべてが同じ1つの配列を参照する。
  */
  const [
    month,
    started,
    vaccinationDates,
    careDates,
    doses,
    vaccinationSchedule,
    usual,
  ] = await Promise.all([
    getMealMonth(ym),
    getStartedInMonth(ym),
    getVaccinationDates(ym),
    getCareDates(range.start, range.endExclusive),
    getHeartwormDoses(),
    getVaccinationSchedule(),
    getUsualMeals(),
  ]);

  // どの日に何の印を出すかは buildCalendarMarks が決めきる（表示側は並べるだけ）。
  // today を渡すのは、トリミング・通院の今日より先の日付（予約）を予定の印にするため
  const marks = buildCalendarMarks({
    careDates,
    vaccinationDates,
    doses,
    vaccinationSchedule,
    range,
    today,
  });

  const byDate = new Map(month.map((d) => [d.date, d]));

  // 「前回をコピー」の対象は、その日より前で記録のある直近の日
  const recordedDates = month.map((d) => d.date).sort();
  const previousOf = (date: DateStr): DateStr | null => {
    let prev: DateStr | null = null;
    for (const d of recordedDates) {
      if (d < date) prev = d;
      else break;
    }
    return prev;
  };

  const data = new Map<DateStr, DayCellData>();
  for (const cell of grid.weeks.flat()) {
    const meals = byDate.get(cell.date) ?? null;
    data.set(cell.date, {
      meals,
      draft: toDraft(cell.date, meals),
      previousDate: previousOf(cell.date),
      // 印が無い日は Map に入っていない
      marks: marks.get(cell.date) ?? [],
    });
  }

  const todayMeals = await getMealDay(today);
  const todayPrev = await getPreviousSlot(today, "morning");

  return (
    <div className="flex flex-col gap-5">
      <MonthNav grid={grid} thisMonth={thisMonth} />

      <div className="flex flex-wrap items-center gap-2">
        <MealDayDialog
          draft={toDraft(today, todayMeals.total > 0 ? todayMeals : null)}
          previousDate={todayPrev?.date ?? null}
          usual={usual}
          triggerVariant="default"
          trigger={
            <>
              <CalendarDays aria-hidden="true" />
              今日を記録
            </>
          }
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {month.length}日ぶんの記録
        </span>
      </div>

      {started.length > 0 && (
        <section className="rounded-lg border p-3">
          <h2 className="font-heading mb-2 inline-flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-4 text-brand-pink" aria-hidden="true" />
            この月から食べ始めたもの
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {started.map((f) => (
              <li key={f.key}>
                <Badge variant="outline" className="font-normal">
                  {formatDate(f.firstDate)}〜{" "}
                  {f.productId !== null ? (
                    <Link href={`/products/${f.productId}`} className="hover:underline">
                      {shortLabel(f.label, 18, f.registeredShortName)}
                    </Link>
                  ) : (
                    shortLabel(f.label, 18)
                  )}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <MonthGridView grid={grid} data={data} today={today} usual={usual} />
      <MonthAgendaView grid={grid} data={data} today={today} usual={usual} />
      {/* 凡例は1回だけ。両ビューの外に置くので画面幅によらず出る */}
      <MarkLegend />
    </div>
  );
}
