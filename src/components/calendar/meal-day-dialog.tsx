"use client";

import { CalendarDays, CopyPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  MealItemRows,
  toRow,
  type DraftRow,
  type RowState,
} from "@/components/calendar/meal-item-rows";
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
import {
  MEAL_SLOTS,
  SLOT_LABEL_LONG,
  formatDayLabel,
  type DateStr,
  type MealSlot,
} from "@/lib/calendar";
import { copyMealDay, saveMealSlot, type MealEntryInput } from "@/lib/actions-log";
import { callAction } from "@/lib/call-action";

/** RSC から渡ってくる、その日の記録（シリアライズ可能な形） */
export interface DayDraft {
  date: DateStr;
  morning: DraftRow[];
  evening: DraftRow[];
  treat: DraftRow[];
}

// 行の形（DraftRow）は行エディタと同じものを使う。ここから出しているのは
// app/calendar/page.tsx・month-grid.tsx・queries-home.ts が DayDraft と
// 一緒にこのパスから取っているため
export type { DraftRow };

type Slots = Record<MealSlot, RowState[]>;

function toSlots(draft: DayDraft): Slots {
  return {
    morning: draft.morning.map(toRow),
    evening: draft.evening.map(toRow),
    treat: draft.treat.map(toRow),
  };
}

function toKnownIds(draft: DayDraft): Record<MealSlot, number[]> {
  const ids = (rows: DraftRow[]) =>
    rows.map((r) => r.id).filter((id): id is number => id !== undefined);
  return {
    morning: ids(draft.morning),
    evening: ids(draft.evening),
    treat: ids(draft.treat),
  };
}

/**
 * 1日ぶんの記録をまとめて編集するダイアログ。
 *
 * スロットごとに分けないのは、実際の使い方が「夜に今日の朝と夜をまとめて
 * 入れる」だから。スロット別だと開閉が2往復になる。グリッドのスロットを
 * 押した場合は initialSlot でそのセクションにスクロールする。
 */
export function MealDayDialog({
  draft,
  previousDate,
  initialSlot,
  trigger,
  triggerVariant = "outline",
  triggerSize = "sm",
}: {
  draft: DayDraft;
  /** 「昨日をコピー」の対象。記録のある直近の日 */
  previousDate: DateStr | null;
  initialSlot?: MealSlot;
  trigger: React.ReactNode;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerSize?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<Slots>(() => toSlots(draft));
  const [knownIds, setKnownIds] = useState<Record<MealSlot, number[]>>(() =>
    toKnownIds(draft),
  );
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setSlots(toSlots(draft));
      // 開いた瞬間の draft から控える。開いているあいだに増えた行
      // （朝8時の cron が入れた「いつものご飯」など）は、こちらの
      // ペイロードに無くても消させないため
      setKnownIds(toKnownIds(draft));
    }
  }

  const valid = MEAL_SLOTS.every((slot) =>
    slots[slot].every((r) => r.productId !== null || r.label.trim() !== ""),
  );

  function handleSave() {
    startTransition(async () => {
      for (const slot of MEAL_SLOTS) {
        const payload: MealEntryInput[] = slots[slot].map((r) => ({
          id: r.id,
          productId: r.productId,
          label: r.label,
          amount: r.amount?.trim() ? r.amount.trim() : null,
          note: r.note?.trim() ? r.note.trim() : null,
        }));
        const res = await callAction(() =>
          saveMealSlot(draft.date, slot, payload, knownIds[slot]),
        );
        if (!res.ok) {
          toast.error("保存に失敗しました", { description: res.error });
          return;
        }
      }
      toast.success("記録しました");
      setOpen(false);
    });
  }

  function handleCopyPrevious() {
    if (!previousDate) return;
    startTransition(async () => {
      const res = await callAction(() => copyMealDay(previousDate, draft.date));
      if (res.ok) {
        toast.success("前回の記録をコピーしました", {
          description: "内容を確認して必要なら直してください。",
        });
        setOpen(false);
      } else {
        toast.error("コピーに失敗しました", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size={triggerSize}>
            {trigger}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{formatDayLabel(draft.date)}の記録</DialogTitle>
          <DialogDescription>
            朝・夜・おやつに食べたものを記録します。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pr-1">
          {MEAL_SLOTS.map((slot) => (
            <section
              key={slot}
              className={
                initialSlot === slot
                  ? "rounded-lg border border-foreground/25 p-3"
                  : "rounded-lg border p-3"
              }
            >
              <div className="mb-2 flex items-center gap-2">
                <h3 className="font-heading text-sm font-medium">{SLOT_LABEL_LONG[slot]}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {slots[slot].length}品
                </span>
              </div>

              {slots[slot].length === 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  まだ記録がありません
                </p>
              )}

              <MealItemRows
                rows={slots[slot]}
                onChange={(next) => setSlots((s) => ({ ...s, [slot]: next }))}
                pickerTitle={`${SLOT_LABEL_LONG[slot]}に食べたものを選ぶ`}
                prefetch={open}
              />
            </section>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={!previousDate || isPending}
            onClick={handleCopyPrevious}
            title={previousDate ? `${previousDate} の記録で置き換えます` : undefined}
          >
            <CopyPlus aria-hidden="true" />
            前回をコピー
          </Button>
          <div className="flex gap-2">
            <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
            <Button disabled={isPending || !valid} onClick={handleSave}>
              {isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ページ上部の「今日を記録」。中身は同じダイアログ。 */
export function TodayButton({
  draft,
  previousDate,
}: {
  draft: DayDraft;
  previousDate: DateStr | null;
}) {
  return (
    <MealDayDialog
      draft={draft}
      previousDate={previousDate}
      triggerVariant="default"
      trigger={
        <>
          <CalendarDays aria-hidden="true" />
          今日を記録
        </>
      }
    />
  );
}
