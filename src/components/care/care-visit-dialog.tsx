"use client";

import { Plus, Scissors, Stethoscope, Trash2 } from "lucide-react";
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
import { saveCareVisit } from "@/lib/actions-care";
import { callAction } from "@/lib/call-action";
import { CARE_KIND_LABEL, type CareKind, type DateStr } from "@/lib/calendar";
import { MAX_ITEMS, parseYen, totalYen } from "@/lib/care";
import { formatYen } from "@/lib/format";

export interface CareVisitDraft {
  id: number;
  date: DateStr;
  place: string | null;
  note: string | null;
  items: { name: string; amountYen: number }[];
}

interface Row {
  key: number;
  name: string;
  amount: string;
}

let nextKey = 1;

const emptyRow = (): Row => ({ key: nextKey++, name: "", amount: "" });

export function CareVisitDialog({
  kind,
  today,
  record,
  trigger,
  triggerVariant = "outline",
}: {
  kind: CareKind;
  today: DateStr;
  /** 渡せば編集、渡さなければ新規 */
  record?: CareVisitDraft;
  trigger: string;
  triggerVariant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(record?.date ?? today);
  const [place, setPlace] = useState(record?.place ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [isPending, startTransition] = useTransition();

  const label = CARE_KIND_LABEL[kind];
  const Icon = kind === "trimming" ? Scissors : Stethoscope;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDate(record?.date ?? today);
      setPlace(record?.place ?? "");
      setNote(record?.note ?? "");
      setRows(
        record && record.items.length > 0
          ? record.items.map((i) => ({
              key: nextKey++,
              name: i.name,
              amount: String(i.amountYen),
            }))
          : [emptyRow()],
      );
    }
  }

  function patch(key: number, next: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  // 合計は入力中もその場で出す。DBに合計の列は持たない（明細が唯一の真実）
  const runningTotal = totalYen(
    rows
      .map((r) => parseYen(r.amount))
      .filter((v): v is number => v !== null)
      .map((amountYen) => ({ amountYen })),
  );

  function handleSave() {
    startTransition(async () => {
      const res = await callAction(() =>
        saveCareVisit({
          id: record?.id,
          kind,
          date,
          place: place.trim() || null,
          note: note.trim() || null,
          items: rows.map((r) => ({ name: r.name, amount: r.amount })),
        }),
      );
      if (res.ok) {
        toast.success(record ? "記録を更新しました" : `${label}を記録しました`);
        setOpen(false);
      } else {
        toast.error("保存に失敗しました", { description: res.error });
      }
    });
  }

  const valid = date !== "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size="sm">
            <Icon aria-hidden="true" />
            {trigger}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {record ? `${label}の記録を編集` : `${label}を記録`}
          </DialogTitle>
          <DialogDescription>
            行った日と、かかった費用の明細を入力します。割引はマイナスで入れてください。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">行った日</span>
            {/* value が YYYY-MM-DD でスキーマと同形 — 変換を挟まない */}
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              {kind === "trimming" ? "お店（任意）" : "動物病院（任意）"}
            </span>
            <Input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={kind === "trimming" ? "例: トリミングサロン◯◯" : "例: ◯◯動物病院"}
            />
          </label>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">明細</span>
              <span className="ml-auto text-sm tabular-nums">
                合計 {formatYen(runningTotal)}
              </span>
            </div>

            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2">
                  <Input
                    value={row.name}
                    onChange={(e) => patch(row.key, { name: e.target.value })}
                    placeholder="品目"
                    aria-label="品目"
                    className="flex-1"
                  />
                  {/* 数字キーパッドを出しつつ、¥ や , を貼れるよう text のまま */}
                  <Input
                    value={row.amount}
                    onChange={(e) => patch(row.key, { amount: e.target.value })}
                    placeholder="金額"
                    aria-label="金額"
                    inputMode="numeric"
                    className="w-28 tabular-nums"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="この行を削除"
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>

            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={rows.length >= MAX_ITEMS}
              onClick={() => setRows((rs) => [...rs, emptyRow()])}
            >
              <Plus aria-hidden="true" />
              行を追加
            </Button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">メモ（任意）</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <DialogFooter className="gap-2">
          <DialogClose render={<Button variant="ghost">キャンセル</Button>} />
          <Button disabled={isPending || !valid} onClick={handleSave}>
            {isPending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
