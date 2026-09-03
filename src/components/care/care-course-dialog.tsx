"use client";

import { Plus, Trash2 } from "lucide-react";
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
import { deleteCareCourse, saveCareCourse } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import type { CareKind } from "@/lib/calendar";
import { formatYen } from "@/lib/format";

/**
 * コースの登録・編集（名前と金額）。編集のときはトリガーが
 * 「名前 ¥金額」のチップになり、削除もこの中に置く（CarePlaceDialog と同じ形）。
 *
 * 明細はコースを参照せず名前と金額を写すだけなので、ここで直しても
 * 過去の記録は変わらない。その旨は説明文で言う。
 */
export function CareCourseDialog({
  kind,
  course,
}: {
  kind: CareKind;
  /** 渡せば編集、渡さなければ新規 */
  course?: { id: number; name: string; priceYen: number | null };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(course?.name ?? "");
  const [price, setPrice] = useState(course?.priceYen === null || course === undefined ? "" : String(course.priceYen));
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(course?.name ?? "");
      setPrice(course?.priceYen === null || course === undefined ? "" : String(course.priceYen));
    }
  }

  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() =>
        saveCareCourse({ id: course?.id, kind, name, price }),
      );
      if (res.ok) {
        toast.success(course ? "コースを更新しました" : "コースを登録しました");
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  function handleDelete() {
    if (!course) return;
    startTransition(async () => {
      const res = await callAction(() => deleteCareCourse(course.id));
      if (res.ok) {
        toast.success("削除しました", { description: "これまでの記録の明細は変わりません。" });
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
          course ? (
            <Button variant="outline" size="xs" title={`${course.name}を編集`}>
              {course.name}
              {course.priceYen !== null && (
                <span className="text-muted-foreground tabular-nums">
                  {formatYen(course.priceYen)}
                </span>
              )}
            </Button>
          ) : (
            <Button variant="ghost" size="xs">
              <Plus aria-hidden="true" />
              コースを登録
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{course ? "コースを編集" : "コースを登録"}</DialogTitle>
          <DialogDescription>
            登録すると、記録の明細に1タップで入れられます。金額は目安として入り、
            当日の金額にあとから直せます。ここで名前や金額を直しても、
            これまでの記録は変わりません。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">コースの名前</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: シャンプーコース"
              autoFocus
              required
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">金額（税込・任意）</span>
            {/* 数字キーパッドを出しつつ、¥ や , を貼れるよう text のまま */}
            <Input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="例: 6,600"
              inputMode="numeric"
              className="w-40 tabular-nums"
            />
            <span className="text-xs text-muted-foreground">
              空欄にすると、明細に入れたときの金額も空欄（未確定）になります。
            </span>
          </label>
        </div>

        <DialogFooter className={course ? "gap-2 sm:justify-between" : "gap-2"}>
          {course && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={isPending}
              onClick={handleDelete}
              title="このコースを削除（記録は変わりません）"
            >
              <Trash2 aria-hidden="true" />
              削除
            </Button>
          )}
          <div className="flex gap-2">
            <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
            <Button disabled={isPending || name.trim() === ""} onClick={handleSave}>
              {isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
