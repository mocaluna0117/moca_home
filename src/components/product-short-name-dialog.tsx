"use client";

import { Tag } from "lucide-react";
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
import {
  clearProductShortName,
  setProductShortName,
} from "@/lib/actions-product-names";
import { callAction } from "@/lib/call-action";
import { MAX_SHORT_NAME, shortLabel } from "@/lib/short-name";

/**
 * 商品に「短い名前」を付ける。
 *
 * ショップの商品名は60〜140文字あり、カレンダーのマス（141px）には入らない。
 * 自動の推定（core-name.ts）は当たることが多いが外す日があり、そのとき名前が
 * 途中で切れる。ここで一度決めれば、カレンダー・ホーム・食べたものの一覧が
 * 全部それを使う。
 *
 * トリガーは登録済みならその名前のチップ、未登録なら「短い名前」ボタン。
 * 消す操作も中に置く（一覧の1行にボタンを2つ並べない）。
 */
export function ProductShortNameDialog({
  productId,
  productName,
  shortName,
}: {
  productId: number;
  /** 商品の正式名。未登録のときに推定の見本を出すのに使う */
  productName: string;
  /** 登録済みの短い名前。未登録なら null */
  shortName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(shortName ?? "");
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // 開くたびに登録の現状から作り直す（前回の入力途中を持ち越さない）
    if (next) setValue(shortName ?? "");
  }

  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() =>
        setProductShortName({ productId, shortName: value }),
      );
      if (res.ok) {
        toast.success("短い名前を登録しました", {
          description: "カレンダーやホームの表示がこの名前になります。",
        });
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      const res = await callAction(() => clearProductShortName(productId));
      if (res.ok) {
        toast.success("短い名前をやめました", {
          description: "商品名から自動で短くした名前に戻ります。",
        });
        setOpen(false);
      } else {
        toast.error("削除に失敗しました", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={shortName ? "outline" : "ghost"} size="xs">
            <Tag aria-hidden="true" />
            {shortName ?? "短い名前"}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>短い名前</DialogTitle>
          <DialogDescription>
            カレンダーのマスやホームの1行など、幅の狭い場所で使う名前です。
            登録しない場合は商品名から自動で短くします。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">この商品の短い名前</span>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="例: ペロリ"
              maxLength={MAX_SHORT_NAME}
              autoFocus
              required
            />
            <span className="text-xs text-muted-foreground">
              {MAX_SHORT_NAME}文字まで。今は「
              {shortLabel(productName, 10, shortName)}」と表示されています。
            </span>
          </label>
        </div>

        <DialogFooter className={shortName ? "gap-2 sm:justify-between" : "gap-2"}>
          {shortName && (
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={handleClear}
              title="短い名前をやめて、商品名からの自動短縮に戻す"
            >
              登録をやめる
            </Button>
          )}
          <div className="flex gap-2">
            <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
            <Button disabled={isPending || value.trim() === ""} onClick={handleSave}>
              {isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
