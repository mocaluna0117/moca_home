import { Syringe } from "lucide-react";

import { PhotoStrip } from "@/components/calendar/photo-strip";
import { VaccinationDialog } from "@/components/calendar/vaccination-dialog";
import { VaccinationDeleteButton } from "@/components/calendar/vaccination-delete-button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import type { VaccinationRow } from "@/lib/queries-log";
import type { DateStr } from "@/lib/calendar";

/** 接種記録の一覧（RSC）。編集・写真の操作はダイアログ側（client）が持つ。 */
export function VaccinationSection({
  records,
  blobEnabled,
  today,
}: {
  records: VaccinationRow[];
  blobEnabled: boolean;
  today: DateStr;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Syringe className="size-4" aria-hidden="true" />
          接種記録
        </h2>
        {records.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {records.length}件
          </span>
        )}
        <div className="ml-auto">
          <VaccinationDialog
            today={today}
            blobEnabled={blobEnabled}
            trigger="接種を記録"
          />
        </div>
      </div>

      {!blobEnabled && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          写真の保存先（Vercel Blob）が未設定です。日付・ワクチン名・メモは保存できます。
        </p>
      )}

      {records.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ記録がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            接種した日とワクチン名を記録し、証明書の写真を添付できます。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {records.map((r) => (
            <li key={r.id} id={`v-${r.id}`} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium tabular-nums">{formatDate(r.date)}</span>
                <span className="text-sm">{r.name}</span>
                {r.clinic && (
                  <span className="text-xs text-muted-foreground">{r.clinic}</span>
                )}
                {r.nextDueDate && (
                  <Badge variant="outline" className="font-normal tabular-nums">
                    次回 {formatDate(r.nextDueDate)}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <VaccinationDialog
                    today={today}
                    blobEnabled={blobEnabled}
                    record={{
                      id: r.id,
                      date: r.date,
                      name: r.name,
                      clinic: r.clinic,
                      nextDueDate: r.nextDueDate,
                      note: r.note,
                      photos: r.photos.map((p) => ({
                        id: p.id,
                        width: p.width,
                        height: p.height,
                      })),
                    }}
                    trigger="編集"
                    triggerVariant="ghost"
                  />
                  <VaccinationDeleteButton id={r.id} />
                </div>
              </div>

              {r.note && (
                <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>
              )}

              {r.photos.length > 0 && (
                <div className="mt-2">
                  <PhotoStrip
                    photos={r.photos.map((p) => ({
                      id: p.id,
                      width: p.width,
                      height: p.height,
                    }))}
                    caption={`${formatDate(r.date)} ・ ${r.name}`}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
