import Link from "next/link";
import { AlertTriangle, Pill, Syringe } from "lucide-react";

import { HeartwormRecordDialog } from "@/components/care/heartworm-record-dialog";
import type { MedicineOption } from "@/components/care/medicine-select";
import { buttonVariants } from "@/components/ui/button";
import type { DateStr } from "@/lib/calendar";
import type { UrgentItem } from "@/lib/home";
import { cn } from "@/lib/utils";

/**
 * 【0】緊急バンド。ホームで唯一「出ない日がある」ブロック。
 *
 * 何が急ぎかは buildHomeSchedule（src/lib/home.ts）が決めきっている。
 * ここで日付を引き算し直さないのは、同じ「過ぎている」を【2】次の予定とも
 * 別々に判定すると、同じことを二度言う日が来るから。title / detail は
 * 出来上がった文として届く。
 *
 * items が空なら **null**。平常日に空の警告枠を残すと、枠そのものが
 * 「何か問題がある」に見えてしまう。
 */
export function UrgentBand({
  items,
  today,
  medicines,
}: {
  items: UrgentItem[];
  today: DateStr;
  /** HeartwormRecordDialog の必須 prop。予定が無い日でも渡ってくる */
  medicines: MedicineOption[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      {/* 見出しは読み上げにだけ渡す。画面では枠と色が既に「急ぎ」を言っている */}
      <h2 className="sr-only">いま気にすること</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          // 過ぎている日は警告記号、当日は種類の記号（当日は失敗ではない）
          const Icon = item.overdue
            ? AlertTriangle
            : item.kind === "heartworm"
              ? Pill
              : Syringe;

          return (
            <li
              key={item.key}
              className={
                item.overdue
                  ? "rounded-lg border-2 border-destructive/40 bg-destructive/5 p-3"
                  : "rounded-lg border-2 border-foreground/25 bg-accent p-3"
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  {/*
                    ページで唯一 font-sans font-semibold を使う行。
                    Hachi Maru Pop は 400 しか無く、太らせると擬似ボールドに
                    なる（09c5578 で測定済み）。警告だけは太さで語りたいので、
                    書体を素のゴシックに替えて逃げ道にする。
                  */}
                  <p
                    className={cn(
                      "inline-flex items-center gap-1.5 font-sans text-sm font-semibold",
                      item.overdue && "text-destructive",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {item.detail}
                  </p>
                </div>
                <div className="sm:ml-auto sm:shrink-0">
                  {/*
                    フィラリアは既存のダイアログをそのまま埋める（トリガーの
                    「飲ませた」は固定。バンド用に新しい prop を足すと、記録の
                    入口が2実装に分かれる）。dose は kind==="heartworm" のとき
                    必ず入っているが、null チェックで narrowing して ! を使わない。
                  */}
                  {item.kind === "heartworm" && item.dose !== null ? (
                    <HeartwormRecordDialog
                      dose={item.dose}
                      today={today}
                      medicines={medicines}
                    />
                  ) : item.kind === "vaccination" ? (
                    // ワクチンはこの場で記録できない（接種日・次回予定日・費用が要る）。
                    // 入力の場所へ運ぶだけにする
                    <Link
                      href="/calendar?tab=vaccination"
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      接種記録を見る
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
