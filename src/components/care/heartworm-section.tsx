import { AlertTriangle, Bell, BellOff, Pill } from "lucide-react";

import { HeartwormClearDialog } from "@/components/care/heartworm-clear-dialog";
import { HeartwormDeleteButton } from "@/components/care/heartworm-delete-button";
import { HeartwormPlanDialog } from "@/components/care/heartworm-plan-dialog";
import { HeartwormRecordDialog } from "@/components/care/heartworm-record-dialog";
import { Badge } from "@/components/ui/badge";
import type { DateStr } from "@/lib/calendar";
import { doseStatus, type DoseStatus } from "@/lib/heartworm";
import { formatDate } from "@/lib/format";
import type { HeartwormRow } from "@/lib/queries-care";

const STATUS_LABEL: Record<DoseStatus, string> = {
  given: "投薬済み",
  today: "今日",
  overdue: "未投薬",
  upcoming: "予定",
};

/** フィラリアの予定一覧（RSC）。 */
export function HeartwormSection({
  doses,
  today,
  mailConfigured,
  medicines,
}: {
  doses: HeartwormRow[];
  today: DateStr;
  /** メールの設定が揃っているか。揃っていなければリマインドは飛ばない */
  mailConfigured: boolean;
  /** フィラリア用として登録された薬だけ */
  medicines: { id: number; name: string }[];
}) {
  const withStatus = doses.map((d) => ({ ...d, status: doseStatus(d, today) }));
  const dueNow = withStatus.filter((d) => d.status === "today" || d.status === "overdue");
  // まとめ削除の対象。今日以降で未実施のものだけ（実績は巻き込まない）
  const clearable = withStatus
    .filter((d) => d.givenDate === null && d.scheduledDate >= today)
    .map((d) => d.scheduledDate);
  const failed = withStatus.filter((d) => d.remindError !== null && d.givenDate === null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Pill className="size-4" aria-hidden="true" />
          フィラリアの予定
        </h2>
        {doses.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {doses.length}件
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <HeartwormClearDialog today={today} targets={clearable} />
          <HeartwormPlanDialog today={today} medicines={medicines} />
        </div>
      </div>

      {dueNow.length > 0 && (
        <div className="rounded-lg border-2 p-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {dueNow.some((d) => d.status === "today")
              ? "今日はフィラリアの日です"
              : `未投薬が${dueNow.length}件あります`}
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {dueNow.map((d) => (
              <li key={d.id} className="text-xs tabular-nums text-muted-foreground">
                {formatDate(d.scheduledDate)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {mailConfigured ? (
          <>
            <Bell className="size-3.5" aria-hidden="true" />
            予定日の朝にメールでお知らせします。飲ませた記録をつけると止まります。
          </>
        ) : (
          <>
            <BellOff className="size-3.5" aria-hidden="true" />
            メールの設定が未完了です（GMAIL_USER / GMAIL_APP_PASSWORD /
            HEARTWORM_MAIL_TO）。予定の記録はこのまま使えます。
          </>
        )}
      </p>

      {failed.length > 0 && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          直近のリマインド送信に失敗しています（{failed[0].remindError}）。
          設定を確認してください。予定は残っているので翌朝もう一度試みます。
        </p>
      )}

      {doses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">まだ予定がありません</p>
          <p className="mt-1 text-xs text-muted-foreground">
            「予定をまとめて作る」で、シーズン分の投薬日を一度に登録できます。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {withStatus.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-3"
            >
              <span
                className={
                  d.status === "today" || d.status === "overdue"
                    ? "font-semibold tabular-nums"
                    : "tabular-nums"
                }
              >
                {formatDate(d.scheduledDate)}
              </span>
              <Badge
                variant={d.status === "given" ? "outline" : "secondary"}
                className="font-normal"
              >
                {STATUS_LABEL[d.status]}
              </Badge>
              {d.label && (
                <span className="text-sm text-muted-foreground">{d.label}</span>
              )}
              {d.givenDate && d.givenDate !== d.scheduledDate && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  実施 {formatDate(d.givenDate)}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <HeartwormRecordDialog
                  dose={{
                    id: d.id,
                    scheduledDate: d.scheduledDate,
                    givenDate: d.givenDate,
                    medicineId: d.medicineId,
                    label: d.label,
                    note: d.note,
                  }}
                  today={today}
                  medicines={medicines}
                />
                <HeartwormDeleteButton
                  id={d.id}
                  scheduledDate={d.scheduledDate}
                  given={d.givenDate !== null}
                />
              </div>
              {d.note && (
                <p className="w-full text-xs text-muted-foreground">{d.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
