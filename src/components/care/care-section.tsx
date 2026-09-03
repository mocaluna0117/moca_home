import { Scissors, Stethoscope } from "lucide-react";

import { CareMasters } from "@/components/care/care-masters";
import { CareVisitDialog } from "@/components/care/care-visit-dialog";
import { CareVisitDeleteButton } from "@/components/care/care-visit-delete-button";
import { Badge } from "@/components/ui/badge";
import { CARE_KIND_LABEL, type CareKind, type DateStr } from "@/lib/calendar";
import { formatDate, formatYen } from "@/lib/format";
import type {
  CareCourseRow,
  CarePlaceRow,
  CareVisitRow,
  CareYearTotal,
} from "@/lib/queries-care";
import { cn } from "@/lib/utils";

/** トリミング／通院の一覧（RSC）。入力はダイアログ側（client）が持つ。 */
export function CareSection({
  kind,
  visits,
  yearTotals,
  today,
  places,
  courses,
}: {
  kind: CareKind;
  visits: CareVisitRow[];
  yearTotals: CareYearTotal[];
  today: DateStr;
  places: CarePlaceRow[];
  courses: CareCourseRow[];
}) {
  const label = CARE_KIND_LABEL[kind];
  const Icon = kind === "trimming" ? Scissors : Stethoscope;
  // 今日より先の日付 = 予約（schema.ts の care_visits）。一覧は新しい順なので先頭に並ぶ
  const upcoming = visits.filter((v) => v.date > today).length;

  const placeOptions = places.map((p) => ({ id: p.id, name: p.name }));
  const courseOptions = courses.map((c) => ({ id: c.id, name: c.name, priceYen: c.priceYen }));
  /**
   * 新規の記録で選んでおくお店。登録が1件だけならそれ、複数なら直近の記録の
   * お店（一覧は新しい順なので先頭から探す）。毎回同じ店を選び直させない。
   */
  const defaultPlaceId =
    places.length === 1
      ? places[0].id
      : (visits.find((v) => v.placeId !== null)?.placeId ?? null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-4" aria-hidden="true" />
          {label}の記録
        </h2>
        {visits.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {visits.length}件{upcoming > 0 && `（予約 ${upcoming}件）`}
          </span>
        )}
        <div className="ml-auto">
          <CareVisitDialog
            kind={kind}
            today={today}
            places={placeOptions}
            courses={courseOptions}
            defaultPlaceId={defaultPlaceId}
            trigger={`${label}を記録`}
          />
        </div>
      </div>

      {yearTotals.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {yearTotals.map((y) => (
            <li key={y.year}>
              {/* 予約（今日より先）は数えない。未確定があれば合計は下限なので添える */}
              <Badge variant="outline" className="font-normal tabular-nums">
                {y.year}年 {y.visits}回 ・ {formatYen(y.totalYen)}
                {y.pending > 0 && `（未確定 ${y.pending}回）`}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <CareMasters kind={kind} places={places} courses={courses} />

      {visits.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ記録がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {kind === "trimming"
              ? "予約した日時とお店、コースを残しておくと、ホームに次の予定が出て、年ごとにいくら使ったかが分かります。"
              : "行った日と明細を残しておくと、年ごとにいくら使ったかが分かります。"}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visits.map((v) => {
            const planned = v.date > today;
            return (
              // 破線 = まだ起きていない（カレンダーの予定の印と同じ記号）
              <li key={v.id} className={cn("rounded-lg border p-3", planned && "border-dashed")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium tabular-nums">
                    {formatDate(v.date)}
                    {v.time && <span className="ml-1.5">{v.time}</span>}
                  </span>
                  {planned ? (
                    <Badge variant="secondary" className="font-normal">
                      予約
                    </Badge>
                  ) : v.date === today ? (
                    <Badge variant="secondary" className="font-normal">
                      今日
                    </Badge>
                  ) : null}
                  {v.place && (
                    <span className="text-sm text-muted-foreground">{v.place}</span>
                  )}
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    {/* 金額の入っていない行がある（または明細が無い）。合計は下限 */}
                    {v.amounts.pending && (
                      <Badge variant="outline" className="font-normal">
                        未確定
                      </Badge>
                    )}
                    <span className="font-semibold tabular-nums">
                      {v.amounts.knownCount === 0 ? "—" : formatYen(v.amounts.totalYen)}
                    </span>
                  </span>
                  <CareVisitDialog
                    kind={kind}
                    today={today}
                    places={placeOptions}
                    courses={courseOptions}
                    record={{
                      id: v.id,
                      date: v.date,
                      time: v.time,
                      placeId: v.placeId,
                      place: v.place,
                      note: v.note,
                      items: v.items.map((i) => ({ name: i.name, amountYen: i.amountYen })),
                    }}
                    trigger="編集"
                    triggerVariant="ghost"
                  />
                  <CareVisitDeleteButton id={v.id} />
                </div>

                {v.items.length > 0 && (
                  <ul className="mt-2 divide-y rounded-md border text-sm">
                    {v.items.map((i) => (
                      <li key={i.id} className="flex items-center gap-3 px-3 py-1.5">
                        <span className="flex-1 break-words">{i.name}</span>
                        {/* null（未確定）は formatYen が「—」にする */}
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            i.amountYen === null && "text-muted-foreground",
                          )}
                        >
                          {formatYen(i.amountYen)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {v.note && (
                  <p className="mt-1 text-xs text-muted-foreground">{v.note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
