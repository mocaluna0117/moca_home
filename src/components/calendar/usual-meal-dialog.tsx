"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { saveUsualMealSlot, type MealEntryInput } from "@/lib/actions-log";
import { callAction } from "@/lib/call-action";
import { SLOT_LABEL_LONG } from "@/lib/calendar";
import type { UsualSlot } from "@/lib/usual-meals";

/**
 * 「いつものご飯」を1スロットぶん登録・編集するダイアログ。
 * 行エディタは記録ダイアログと同じ MealItemRows（自由度を揃える）。
 *
 * 保存すると saveUsualMealSlot が続けて applyUsualMeals() を呼ぶので、
 * **今日の記録が変わることがある**。記録に「いつもの」印を付けない決定の
 * 代わりに、その結果（appliedToday）をトーストで言うのがここの役目。
 *
 * 失敗したら閉じない（入力中の行を失わせない）。行は state だけが持つので、
 * 閉じれば消え、次に開いたときは handleOpenChange が rows から作り直す。
 */
export function UsualMealDialog({
  slot,
  rows,
  triggerVariant = "outline",
}: {
  slot: UsualSlot;
  rows: DraftRow[];
  triggerVariant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RowState[]>(() => rows.map(toRow));
  const [isPending, startTransition] = useTransition();

  const label = SLOT_LABEL_LONG[slot];
  const registered = rows.length > 0;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // 開くたびに親から来た rows で作り直す。前回開いて閉じた時の入力途中や、
    // 別のタブで登録を変えたあとの古い行を持ち越さないため
    if (next) setItems(rows.map(toRow));
  }

  // 記録ダイアログと同じ門。商品を選んでいない自由入力の空行は保存させない
  const valid = items.every((r) => r.productId !== null || r.label.trim() !== "");

  /**
   * 保存も「登録を消す」も同じ1つのアクション（空配列で保存するのがオフの
   * 手段）。文面だけを送る中身で分けるので、行を全部消して保存した場合も
   * 「消しました」と言える。
   */
  function submit(next: MealEntryInput[]) {
    startTransition(async () => {
      const res = await callAction(() => saveUsualMealSlot(slot, next));
      if (!res.ok) {
        // 閉じない。開いたままなら入力中の行が残っていて、もう一度押せる
        toast.error(next.length === 0 ? "削除に失敗しました" : "保存に失敗しました", {
          description: res.error,
        });
        return;
      }
      if (next.length === 0) {
        toast.success(`いつもの${label}の登録を消しました`, {
          description: "これまでに入った記録はそのまま残ります。",
        });
      } else {
        toast.success(
          registered
            ? `いつもの${label}を更新しました`
            : `いつもの${label}を登録しました`,
          {
            // 印を付けない代わりの唯一のフィードバック
            description: res.appliedToday
              ? "今日のぶんも記録しました。"
              : "今日はすでに記録があるので、そのままにしました。",
          },
        );
      }
      setOpen(false);
    });
  }

  function handleSave() {
    submit(
      items.map((r) => ({
        id: r.id,
        productId: r.productId,
        label: r.label,
        amount: r.amount?.trim() ? r.amount.trim() : null,
        note: r.note?.trim() ? r.note.trim() : null,
      })),
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm">
            {registered ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {registered ? "編集" : `いつもの${label}を登録`}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>いつもの{label}</DialogTitle>
          <DialogDescription>
            毎朝、その日の{label}がまだ空なら、ここに登録したものを記録として入れます。
            中身を変えても、これまでに入った記録は変わりません。
          </DialogDescription>
        </DialogHeader>

        {/* flex にしないのは、MealItemRows の末尾にある「食べたものを追加」が
            伸びて全幅ボタンになるため（記録ダイアログでも素のブロック） */}
        <div className="max-h-[62vh] overflow-y-auto pr-1">
          {items.length === 0 && (
            <p className="mb-2 text-xs text-muted-foreground">まだ登録がありません</p>
          )}
          <MealItemRows
            rows={items}
            onChange={setItems}
            pickerTitle={`${label}に食べたものを選ぶ`}
            prefetch={open}
          />
        </div>

        <DialogFooter className={registered ? "gap-2 sm:justify-between" : "gap-2"}>
          {/* 「消す」は登録があるときだけ。無いときに出すと、何を消すのか
              分からないボタンが1つ増える */}
          {registered && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => submit([])}
              title={`いつもの${label}の登録を消す（記録は残ります）`}
            >
              <Trash2 aria-hidden="true" />
              登録を消す
            </Button>
          )}
          <div className="flex gap-2">
            <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
            {/* 登録が無いまま0品で保存しても何も起きないので押させない
                （登録があるときの0品は「消す」なので通す） */}
            <Button
              disabled={isPending || !valid || (items.length === 0 && !registered)}
              onClick={handleSave}
            >
              {isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
