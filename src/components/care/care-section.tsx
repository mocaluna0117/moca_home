import { Scissors, Stethoscope } from "lucide-react";

import { CareVisitDialog } from "@/components/care/care-visit-dialog";
import { CareVisitDeleteButton } from "@/components/care/care-visit-delete-button";
import { Badge } from "@/components/ui/badge";
import { CARE_KIND_LABEL, type CareKind, type DateStr } from "@/lib/calendar";
import { formatDate, formatYen } from "@/lib/format";
import type { CareVisitRow, CareYearTotal } from "@/lib/queries-care";

/** トリミング／通院の一覧（RSC）。入力はダイアログ側（client）が持つ。 */
export function CareSection({
  kind,
  visits,
  yearTotals,
  today,
}: {
  kind: CareKind;
  visits: CareVisitRow[];
  yearTotals: CareYearTotal[];
  today: DateStr;
}) {
  const label = CARE_KIND_LABEL[kind];
  const Icon = kind === "trimming" ? Scissors : Stethoscope;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-4" aria-hidden="true" />
          {label}の記録
        </h2>
        {visits.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {visits.length}件
          </span>
        )}
        <div className="ml-auto">
          <CareVisitDialog kind={kind} today={today} trigger={`${label}を記録`} />
        </div>
      </div>

      {yearTotals.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {yearTotals.map((y) => (
            <li key={y.year}>
              <Badge variant="outline" className="font-normal tabular-nums">
                {y.year}年 {y.visits}回 ・ {formatYen(y.totalYen)}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {visits.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ記録がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            行った日と明細を残しておくと、年ごとにいくら使ったかが分かります。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visits.map((v) => (
            <li key={v.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium tabular-nums">{formatDate(v.date)}</span>
                {v.place && (
                  <span className="text-sm text-muted-foreground">{v.place}</span>
                )}
                <span className="ml-auto font-semibold tabular-nums">
                  {formatYen(v.totalYen)}
                </span>
                <CareVisitDialog
                  kind={kind}
                  today={today}
                  record={{
                    id: v.id,
                    date: v.date,
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
                      <span className="shrink-0 tabular-nums">
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
          ))}
        </ul>
      )}
    </section>
  );
}
