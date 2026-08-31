"use client";

import { Check, Trash2 } from "lucide-react";
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
import { MedicineSelect, type MedicineOption } from "@/components/care/medicine-select";
import { deleteHeartwormDose, recordHeartwormDose } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import type { DateStr } from "@/lib/calendar";
import { formatDate } from "@/lib/format";

/** 1件の予定に「飲ませた」を記録する。日付を空にすれば未実施に戻せる。 */
export function HeartwormRecordDialog({
  dose,
  today,
  medicines,
}: {
  dose: {
    id: number;
    scheduledDate: DateStr;
    givenDate: DateStr | null;
    medicineId: number | null;
    label: string | null;
    note: string | null;
  };
  today: DateStr;
  /** フィラリア用として登録された薬だけ */
  medicines: MedicineOption[];
}) {
  const [open, setOpen] = useState(false);
  const [givenDate, setGivenDate] = useState(dose.givenDate ?? "");
  const [medicineId, setMedicineId] = useState<number | null>(dose.medicineId);
  const [note, setNote] = useState(dose.note ?? "");
  const [isPending, startTransition] = useTransition();

  const done = dose.givenDate !== null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // 未実施なら「今日飲ませた」がいちばん多いので、初期値を今日にする
      setGivenDate(dose.givenDate ?? today);
      setMedicineId(dose.medicineId);
      setNote(dose.note ?? "");
    }
  }

  function save(nextGiven: string | null) {
    startTransition(async () => {
      const res = await callAction(() =>
        recordHeartwormDose({
          id: dose.id,
          givenDate: nextGiven,
          medicineId,
          note: note.trim() || null,
        }),
      );
      if (res.ok) {
        toast.success(nextGiven ? "飲ませた記録をつけました" : "未実施に戻しました");
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await callAction(() => deleteHeartwormDose(dose.id));
      if (res.ok) {
        toast.success("予定を削除しました");
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
          <Button variant={done ? "ghost" : "outline"} size="sm">
            {done ? "編集" : (
              <>
                <Check aria-hidden="true" />
                飲ませた
              </>
            )}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{formatDate(dose.scheduledDate)}の投薬</DialogTitle>
          <DialogDescription>
            飲ませた日を記録すると、この予定のリマインドは止まります。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">飲ませた日</span>
            <Input
              type="date"
              value={givenDate}
              onChange={(e) => setGivenDate(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">薬（任意）</span>
            <MedicineSelect
              value={medicineId}
              onChange={setMedicineId}
              options={medicines}
              emptyHint="「薬」タブでフィラリア予防薬を登録すると、ここで選べます。"
            />
            {dose.medicineId === null && dose.label && (
              <span className="text-xs text-muted-foreground">
                以前の記録: {dose.label}（登録から消された薬）
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">メモ（任意）</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {done && (
              <Button variant="outline" size="sm" disabled={isPending} onClick={() => save(null)}>
                未実施に戻す
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={isPending}
              onClick={remove}
            >
              <Trash2 aria-hidden="true" />
              この予定を削除
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button
            disabled={isPending || givenDate === ""}
            onClick={() => save(givenDate)}
          >
            {isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
