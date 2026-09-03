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
import { deleteCarePlace, saveCarePlace } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import type { CareKind } from "@/lib/calendar";

/** 「お店」「病院」。actions-care.ts のエラー文は「動物病院」だが、見出しは短く */
const NOUN: Record<CareKind, string> = { trimming: "お店", hospital: "病院" };
const PLACEHOLDER: Record<CareKind, string> = {
  trimming: "例: トリミングサロン◯◯",
  hospital: "例: ◯◯動物病院",
};

/**
 * いつも行くお店・病院の登録・編集。持たせるのは名前だけ
 * （住所・電話は持たない — schema.ts の care_places の PII 方針）。
 *
 * 編集のときはトリガーが名前のチップになり、削除もこの中に置く。
 * 一覧が「名前 × 登録数」のチップの列で済み、行ごとの削除ボタンで
 * 横に伸びない（薬の一覧は行が広いので別ボタンにしてある）。
 */
export function CarePlaceDialog({
  kind,
  place,
}: {
  kind: CareKind;
  /** 渡せば編集、渡さなければ新規 */
  place?: { id: number; name: string; usedCount: number };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(place?.name ?? "");
  const [isPending, startTransition] = useTransition();
  const noun = NOUN[kind];

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setName(place?.name ?? "");
  }

  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() => saveCarePlace({ id: place?.id, kind, name }));
      if (res.ok) {
        toast.success(place ? `${noun}を更新しました` : `${noun}を登録しました`);
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  function handleDelete() {
    if (!place) return;
    startTransition(async () => {
      const res = await callAction(() => deleteCarePlace(place.id));
      if (res.ok) {
        toast.success("削除しました", {
          description:
            place.usedCount > 0 ? `${place.usedCount}件の記録には名前が残ります。` : undefined,
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
          place ? (
            <Button variant="outline" size="xs" title={`${place.name}を編集`}>
              {place.name}
            </Button>
          ) : (
            <Button variant="ghost" size="xs">
              <Plus aria-hidden="true" />
              {noun}を登録
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{place ? `${noun}を編集` : `${noun}を登録`}</DialogTitle>
          <DialogDescription>
            登録すると、記録するときに名前を打たずに選べます。
            名前を直すと、この{noun}を選んである記録の表示も一緒に直ります。
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{noun}の名前</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={PLACEHOLDER[kind]}
            autoFocus
            required
          />
        </label>

        <DialogFooter className={place ? "gap-2 sm:justify-between" : "gap-2"}>
          {place && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={isPending}
              onClick={handleDelete}
              title={
                place.usedCount > 0
                  ? `${place.usedCount}件の記録で使われています（記録は残ります）`
                  : `この${noun}を削除`
              }
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
