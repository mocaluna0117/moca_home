"use client";

import { CalendarX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { clearUpcomingHeartwormDoses } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import type { DateStr } from "@/lib/calendar";
import { formatDate } from "@/lib/format";

/**
 * 未実施の予定をまとめて消す。
 *
 * 日付や間隔を間違えて一括生成したときのやり直し用。1件ずつ消すのは
 * 7件でも面倒なので入口を分けた。
 * **投薬済みの記録は消さない**（実績なので、まとめ消しの巻き添えにしない）。
 * こちらは件数が多くなりうるので、消す前に対象を見せて確認を取る。
 */
export function HeartwormClearDialog({
  today,
  targets,
}: {
  today: DateStr;
  /** 消える予定の日付。今日以降で未実施のもの */
  targets: DateStr[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClear() {
    startTransition(async () => {
      const res = await callAction(() => clearUpcomingHeartwormDoses(today));
      if (res.ok) {
        toast.success(`予定を${res.deleted}件削除しました`);
        setOpen(false);
      } else {
        toast.error("削除に失敗しました", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={targets.length === 0}>
            <CalendarX aria-hidden="true" />
            まとめて削除
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>未実施の予定をまとめて削除</DialogTitle>
          <DialogDescription>
            今日以降で、まだ飲ませていない予定を削除します。
            <strong className="font-medium">投薬済みの記録は消えません。</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border p-3">
          <p className="text-sm">
            消える予定{" "}
            <span className="font-semibold tabular-nums">{targets.length}件</span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {targets.map((d) => (
              <li key={d} className="rounded-md border px-2 py-0.5 text-xs tabular-nums">
                {formatDate(d)}
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button
            disabled={isPending || targets.length === 0}
            onClick={handleClear}
          >
            {isPending ? "削除中…" : `${targets.length}件を削除`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
