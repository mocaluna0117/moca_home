"use client";

import { CalendarPlus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { generateHeartwormSchedule } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import type { DateStr } from "@/lib/calendar";
import { generateDoseDates } from "@/lib/heartworm";
import { formatDate } from "@/lib/format";

/** 期間を指定して予定をまとめて作る。すでにある日は飛ばす。 */
export function HeartwormPlanDialog({ today }: { today: DateStr }) {
  const thisYear = today.slice(0, 4);
  const [open, setOpen] = useState(false);
  // 日本のフィラリア予防は5月〜11月ごろが目安。初期値をそこに寄せておく
  const [startMonth, setStartMonth] = useState(`${thisYear}-05`);
  const [endMonth, setEndMonth] = useState(`${thisYear}-11`);
  const [day, setDay] = useState("15");
  const [label, setLabel] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setStartMonth(`${thisYear}-05`);
      setEndMonth(`${thisYear}-11`);
      setDay("15");
      setLabel("");
    }
  }

  // 保存する前に、実際にどの日が作られるかを見せる。
  // 画面と同じ関数をサーバでも使うので、出た通りの日付が入る
  const preview = generateDoseDates({
    startMonth,
    endMonth,
    dayOfMonth: Number(day),
  });

  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() =>
        generateHeartwormSchedule({
          startMonth,
          endMonth,
          dayOfMonth: Number(day),
          label: label.trim() || null,
        }),
      );
      if (res.ok) {
        toast.success(`予定を${res.created}件作りました`, {
          description:
            res.skipped > 0 ? `${res.skipped}件はすでにあったので飛ばしました。` : undefined,
        });
        setOpen(false);
      } else {
        toast.error("予定を作れませんでした", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <CalendarPlus aria-hidden="true" />
            予定をまとめて作る
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>フィラリアの予定を作る</DialogTitle>
          <DialogDescription>
            期間と毎月の日を決めると、その分の予定をまとめて作ります。
            あとから1件ずつ日付を変えたり消したりできます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">始まりの月</span>
              <Input
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">終わりの月</span>
              <Input
                type="month"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">毎月</span>
              <span className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  className="w-20 tabular-nums"
                  aria-label="毎月の日"
                />
                <span className="text-sm text-muted-foreground">日</span>
              </span>
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">薬の名前（任意）</span>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: モキシデック チュアブル"
            />
          </label>

          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">作られる予定</p>
            {preview.ok ? (
              <>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {preview.dates.length}件
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {preview.dates.map((d) => (
                    <li
                      key={d}
                      className="rounded-md border px-2 py-0.5 text-xs tabular-nums"
                    >
                      {formatDate(d)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  31日を指定した月に31日が無い場合は、その月の末日にします。
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                期間と日を正しく指定してください。
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button disabled={isPending || !preview.ok} onClick={handleSave}>
            {isPending ? "作成中…" : "この内容で作る"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
