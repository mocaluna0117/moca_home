import { CalendarDays, Sparkles, UtensilsCrossed } from "lucide-react";
import Link from "next/link";

import {
  MonthAgendaView,
  MonthGridView,
  type DayCellData,
} from "@/components/calendar/month-grid";
import { MealDayDialog, type DayDraft } from "@/components/calendar/meal-day-dialog";
import { MonthNav } from "@/components/calendar/month-nav";
import { VaccinationSection } from "@/components/calendar/vaccination-section";
import { FavoriteButton } from "@/components/favorite-button";
import { ProductName } from "@/components/product-name";
import { SegmentedNav } from "@/components/segmented-nav";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isBlobConfigured } from "@/lib/blob";
import {
  SLOT_LABEL,
  buildMonthGrid,
  parseYearMonth,
  todayJst,
  yearMonthOf,
  type DateStr,
} from "@/lib/calendar";
import { formatDate, nowJstIso } from "@/lib/format";
import { shortLabel } from "@/lib/short-name";
import {
  getFoodHistory,
  getMealDay,
  getMealMonth,
  getPreviousSlot,
  getStartedInMonth,
  getVaccinationDates,
  getVaccinations,
  type DayMeals,
} from "@/lib/queries-log";
import { getFavoriteProductIds } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Tab = "log" | "foods" | "vaccination";

function toDraft(date: DateStr, meals: DayMeals | null): DayDraft {
  const map = (rows: DayMeals["morning"]) =>
    rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      label: r.label,
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

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const rawM = Array.isArray(params.m) ? params.m[0] : params.m;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;

  const today = todayJst(nowJstIso());
  const thisMonth = yearMonthOf(today);
  // 不正な ?m= は 404 にせず今月へフォールバックする
  const ym = parseYearMonth(rawM) ?? thisMonth;
  const tab: Tab =
    rawTab === "foods" || rawTab === "vaccination" ? rawTab : "log";

  const grid = buildMonthGrid(ym)!;

  const tabs = [
    { value: "log", label: "記録", href: `/calendar?m=${ym}` },
    { value: "foods", label: "食べたもの", href: `/calendar?m=${ym}&tab=foods` },
    {
      value: "vaccination",
      label: "接種記録",
      href: `/calendar?m=${ym}&tab=vaccination`,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <MonthNav grid={grid} tab={tab} thisMonth={thisMonth} />
        <SegmentedNav items={tabs} current={tab} />
      </div>

      {tab === "log" && <LogTab ym={ym} grid={grid} today={today} />}
      {tab === "foods" && <FoodsTab />}
      {tab === "vaccination" && (
        <VaccinationSection
          records={await getVaccinations()}
          blobEnabled={isBlobConfigured()}
          today={today}
        />
      )}
    </div>
  );
}

async function LogTab({
  ym,
  grid,
  today,
}: {
  ym: string;
  grid: NonNullable<ReturnType<typeof buildMonthGrid>>;
  today: DateStr;
}) {
  const [month, started, vaccineDates] = await Promise.all([
    getMealMonth(ym),
    getStartedInMonth(ym),
    getVaccinationDates(ym),
  ]);

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
      vaccines: vaccineDates.get(cell.date) ?? [],
    });
  }

  const todayMeals = await getMealDay(today);
  const todayPrev = await getPreviousSlot(today, "morning");

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <MealDayDialog
          draft={toDraft(today, todayMeals.total > 0 ? todayMeals : null)}
          previousDate={todayPrev?.date ?? null}
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
          <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-4" aria-hidden="true" />
            この月から食べ始めたもの
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {started.map((f) => (
              <li key={f.key}>
                <Badge variant="outline" className="font-normal">
                  {formatDate(f.firstDate)}〜{" "}
                  {f.productId !== null ? (
                    <Link href={`/products/${f.productId}`} className="hover:underline">
                      {shortLabel(f.label, 18)}
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

      <MonthGridView grid={grid} data={data} today={today} />
      <MonthAgendaView grid={grid} data={data} today={today} />
    </>
  );
}

async function FoodsTab() {
  const [foods, favoriteIds] = await Promise.all([
    getFoodHistory(),
    getFavoriteProductIds(),
  ]);

  if (foods.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <UtensilsCrossed className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">まだ食事の記録がありません</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          「記録」タブでカレンダーの日を選ぶと、朝・夜・おやつを登録できます。
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {foods.length}種類の食べもの
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>食べたもの</TableHead>
              <TableHead className="text-right">食べ始め</TableHead>
              <TableHead className="text-right">最後</TableHead>
              <TableHead className="text-right">日数</TableHead>
              <TableHead className="text-right">朝/夜/おやつ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {foods.map((f) => (
              <TableRow key={f.key}>
                <TableCell className="max-w-md whitespace-normal">
                  {f.productId !== null ? (
                    <Link
                      href={`/products/${f.productId}`}
                      className="text-sm leading-snug hover:underline"
                    >
                      <ProductName name={f.label} />
                    </Link>
                  ) : (
                    <span className="text-sm leading-snug">
                      <ProductName name={f.label} />
                    </span>
                  )}
                  {f.productId !== null && (
                    <div className="mt-1">
                      <FavoriteButton
                        productId={f.productId}
                        isFavorite={favoriteIds.has(f.productId)}
                        size="sm"
                      />
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDate(f.firstDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDate(f.lastDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{f.dayCount}日</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                  {f.slots.morning}/{f.slots.evening}/{f.slots.treat}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {SLOT_LABEL.morning}・{SLOT_LABEL.evening}・{SLOT_LABEL.treat}の順に、
        それぞれ何回登録したかを表示しています。
      </p>
    </section>
  );
}
