"use client";

import { Pill, Plus } from "lucide-react";
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
import { saveMedicine } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";

/** 薬の登録・編集。持たせるのは名前と「フィラリア用か」だけ。 */
export function MedicineDialog({
  medicine,
  trigger,
  triggerVariant = "outline",
}: {
  medicine?: { id: number; name: string; forHeartworm: boolean };
  trigger?: string;
  triggerVariant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(medicine?.name ?? "");
  const [forHeartworm, setForHeartworm] = useState(medicine?.forHeartworm ?? false);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(medicine?.name ?? "");
      setForHeartworm(medicine?.forHeartworm ?? false);
    }
  }

  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() =>
        saveMedicine({ id: medicine?.id, name, forHeartworm }),
      );
      if (res.ok) {
        toast.success(medicine ? "薬を更新しました" : "薬を登録しました");
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm">
            {medicine ? <Pill aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {trigger ?? (medicine ? "編集" : "薬を登録")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{medicine ? "薬を編集" : "薬を登録"}</DialogTitle>
          <DialogDescription>
            登録すると、記録するときに選べるようになります。
            名前を直すと、この薬を選んである記録の表示も一緒に直ります。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">薬の名前</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: モキシデック チュアブル"
              autoFocus
              required
            />
          </label>

          <label className="flex items-start gap-2 rounded-lg border p-3">
            <input
              type="checkbox"
              checked={forHeartworm}
              onChange={(e) => setForHeartworm(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">フィラリア予防薬</span>
              <span className="text-xs text-muted-foreground">
                入れておくと、フィラリアの記録でこの薬を選べるようになります。
                入れなければ薬の一覧に残るだけです。
              </span>
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button disabled={isPending || name.trim() === ""} onClick={handleSave}>
            {isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
