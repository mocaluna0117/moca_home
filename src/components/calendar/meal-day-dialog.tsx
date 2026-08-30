"use client";

import { CalendarDays, CopyPlus, Plus, Search, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Thumb } from "@/components/catalog-picker";
import { ProductSearchDialog } from "@/components/product-search-dialog";
import { ProductName } from "@/components/product-name";
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
import {
  MEAL_SLOTS,
  SLOT_LABEL_LONG,
  formatDayLabel,
  type DateStr,
  type MealSlot,
} from "@/lib/calendar";
import { copyMealDay, saveMealSlot, type MealEntryInput } from "@/lib/actions-log";

/** RSC から渡ってくる、その日の記録（シリアライズ可能な形） */
export interface DayDraft {
  date: DateStr;
  morning: DraftRow[];
  evening: DraftRow[];
  treat: DraftRow[];
}

export interface DraftRow {
  id?: number;
  productId: number | null;
  label: string;
  amount: string | null;
  note: string | null;
  imageUrl: string | null;
}

interface RowState extends DraftRow {
  key: number;
  /** 商品を選ぶモードか、自由入力モードか */
  mode: "product" | "free";
  query: string;
}

let nextKey = 1;

function toRow(d: DraftRow): RowState {
  return {
    ...d,
    key: nextKey++,
    mode: d.productId === null && d.label ? "free" : "product",
    query: "",
  };
}

function emptyRow(): RowState {
  return {
    key: nextKey++,
    productId: null,
    label: "",
    amount: null,
    note: null,
    imageUrl: null,
    mode: "product",
    query: "",
  };
}

type Slots = Record<MealSlot, RowState[]>;

function toSlots(draft: DayDraft): Slots {
  return {
    morning: draft.morning.map(toRow),
    evening: draft.evening.map(toRow),
    treat: draft.treat.map(toRow),
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
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setSlots(toSlots(draft));
  }

  function patch(slot: MealSlot, key: number, p: Partial<RowState>) {
    setSlots((s) => ({
      ...s,
      [slot]: s[slot].map((r) => (r.key === key ? { ...r, ...p } : r)),
    }));
  }

  function addRow(slot: MealSlot) {
    setSlots((s) => ({ ...s, [slot]: [...s[slot], emptyRow()] }));
  }

  function removeRow(slot: MealSlot, key: number) {
    setSlots((s) => ({ ...s, [slot]: s[slot].filter((r) => r.key !== key) }));
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
        const res = await saveMealSlot(draft.date, slot, payload);
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
      const res = await copyMealDay(previousDate, draft.date);
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
                <h3 className="text-sm font-medium">{SLOT_LABEL_LONG[slot]}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {slots[slot].length}品
                </span>
              </div>

              {slots[slot].length === 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  まだ記録がありません
                </p>
              )}

              <div className="flex flex-col gap-2">
                {slots[slot].map((row) => (
                  <div key={row.key} className="flex flex-col gap-2 rounded-md border p-2">
                    {row.mode === "product" ? (
                      row.productId === null ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <ProductSearchDialog
                              prefetch={open}
                              nested
                              title={`${SLOT_LABEL_LONG[slot]}に食べたものを選ぶ`}
                              description="20&20 の全商品から探せます。お気に入りは先頭に表示されます。"
                              trigger={
                                <>
                                  <Search aria-hidden="true" />
                                  商品を選ぶ
                                </>
                              }
                              onSelect={(c) =>
                                patch(slot, row.key, {
                                  productId: c.id,
                                  label: c.name,
                                  imageUrl: c.imageUrl,
                                  query: "",
                                })
                              }
                            />
                            <span className="text-xs text-muted-foreground">
                              まだ選ばれていません
                            </span>
                          </div>
                          <button
                            type="button"
                            className="w-fit text-xs text-muted-foreground underline"
                            onClick={() => patch(slot, row.key, { mode: "free" })}
                          >
                            商品リストにない（自由入力へ）
                          </button>
                        </>
                      ) : (
                        <div className="flex items-start gap-2">
                          <Thumb src={row.imageUrl} alt="" />
                          <span className="flex-1 text-sm leading-snug break-words">
                            <ProductName name={row.label} />
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              patch(slot, row.key, {
                                productId: null,
                                label: "",
                                imageUrl: null,
                              })
                            }
                          >
                            変更
                          </Button>
                        </div>
                      )
                    ) : (
                      <>
                        <Input
                          value={row.label}
                          onChange={(e) =>
                            patch(slot, row.key, { label: e.target.value })
                          }
                          placeholder="食べたもの（例: 手作りごはん）"
                          aria-label="食べたもの"
                        />
                        <button
                          type="button"
                          className="w-fit text-xs text-muted-foreground underline"
                          onClick={() =>
                            patch(slot, row.key, {
                              mode: "product",
                              label: "",
                              productId: null,
                            })
                          }
                        >
                          商品リストから選ぶ
                        </button>
                      </>
                    )}

                    <div className="flex items-center gap-2">
                      <Input
                        value={row.amount ?? ""}
                        onChange={(e) =>
                          patch(slot, row.key, { amount: e.target.value || null })
                        }
                        placeholder="分量（例: 50g）"
                        aria-label="分量"
                        className="w-32"
                      />
                      <Input
                        value={row.note ?? ""}
                        onChange={(e) =>
                          patch(slot, row.key, { note: e.target.value || null })
                        }
                        placeholder="メモ（任意）"
                        aria-label="メモ"
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="この行を削除"
                        onClick={() => removeRow(slot, row.key)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => addRow(slot)}
              >
                <Plus aria-hidden="true" />
                食べたものを追加
              </Button>
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
