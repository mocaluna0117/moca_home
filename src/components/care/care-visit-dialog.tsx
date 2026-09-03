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
import { MAX_ITEMS, parseYen, summarizeAmounts } from "@/lib/care";
import { formatYen } from "@/lib/format";

export interface CareVisitDraft {
  id: number;
  date: DateStr;
  /** "HH:MM"。未設定なら null */
  time: string | null;
  /** 登録したお店の id。登録から消されたか自由入力なら null */
  placeId: number | null;
  /** 表示名（登録側を優先して解決済み）。自由入力ならそのもの */
  place: string | null;
  note: string | null;
  items: { name: string; amountYen: number | null }[];
}

/** 登録したお店・病院（この種類のぶんだけ） */
export interface PlaceOption {
  id: number;
  name: string;
}

/** 登録したコース。金額は明細に写す初期値で、あとから直せる */
export interface CourseOption {
  id: number;
  name: string;
  priceYen: number | null;
}

interface Row {
  key: number;
  name: string;
  amount: string;
}

let nextKey = 1;

const emptyRow = (): Row => ({ key: nextKey++, name: "", amount: "" });
const isBlank = (r: Row) => r.name.trim() === "" && r.amount.trim() === "";

/** お店の選び方。"" = 指定しない / 数字 = 登録したお店の id / FREE = 自由入力 */
const FREE = "free";

/** MedicineSelect と同じ見た目。ライブラリを増やさずネイティブの select */
const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/**
 * 文言だけを種類で変える。入力の形（日付・時間・行き先・明細・メモ）と
 * 検証は2種類で共通 — トリミングは「予約した日」、通院は「行った日」を
 * 入れるが、どちらも未来の日付と空欄の金額を受ける（schema.ts の care_visits）。
 */
const WORDING: Record<
  CareKind,
  {
    dateLabel: string;
    placeLabel: string;
    placePlaceholder: string;
    placeHint: string;
    description: string;
  }
> = {
  trimming: {
    dateLabel: "予約日",
    placeLabel: "お店（任意）",
    placePlaceholder: "例: トリミングサロン◯◯",
    placeHint: "「いつも行くお店」に登録すると、ここで選べます。",
    description:
      "予約した日時とお店、コースの明細を入力します。金額がまだ分からない行は空欄のままで保存できます。割引はマイナスで入れてください。",
  },
  hospital: {
    dateLabel: "行った日",
    placeLabel: "動物病院（任意）",
    placePlaceholder: "例: ◯◯動物病院",
    placeHint: "「いつも行く病院」に登録すると、ここで選べます。",
    description:
      "行った日と、かかった費用の明細を入力します。金額が分からない行は空欄のままで保存できます。割引はマイナスで入れてください。",
  },
};

/**
 * 開いたときのお店の選択。編集なら記録どおり（登録が消えていれば自由入力に
 * 写しの名前を残す）、新規なら親が決めた既定（1件だけの登録・前回のお店）。
 */
function initialPlaceChoice(
  record: CareVisitDraft | undefined,
  places: PlaceOption[],
  defaultPlaceId: number | null,
): string {
  const known = (id: number | null) => id !== null && places.some((p) => p.id === id);
  if (record) {
    if (known(record.placeId)) return String(record.placeId);
    return record.place ? FREE : "";
  }
  return known(defaultPlaceId) ? String(defaultPlaceId) : "";
}

export function CareVisitDialog({
  kind,
  today,
  record,
  places,
  courses,
  defaultPlaceId = null,
  trigger,
  triggerVariant = "outline",
}: {
  kind: CareKind;
  today: DateStr;
  /** 渡せば編集、渡さなければ新規 */
  record?: CareVisitDraft;
  places: PlaceOption[];
  /** 空なら「コースから追加」の段そのものを出さない（通院はいつも空） */
  courses: CourseOption[];
  /** 新規のときに選んでおくお店。null なら未選択 */
  defaultPlaceId?: number | null;
  trigger: string;
  triggerVariant?: "default" | "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(record?.date ?? today);
  const [time, setTime] = useState(record?.time ?? "");
  const [placeChoice, setPlaceChoice] = useState(() =>
    initialPlaceChoice(record, places, defaultPlaceId),
  );
  const [placeText, setPlaceText] = useState(record?.placeId === null ? record.place ?? "" : "");
  const [note, setNote] = useState(record?.note ?? "");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [isPending, startTransition] = useTransition();

  const label = CARE_KIND_LABEL[kind];
  const words = WORDING[kind];
  const Icon = kind === "trimming" ? Scissors : Stethoscope;
  // 登録が1件も無いなら、選ぶ欄を出さず自由入力だけにする
  const hasPlaces = places.length > 0;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDate(record?.date ?? today);
      setTime(record?.time ?? "");
      setPlaceChoice(initialPlaceChoice(record, places, defaultPlaceId));
      setPlaceText(record && record.placeId === null ? (record.place ?? "") : "");
      setNote(record?.note ?? "");
      setRows(
        record && record.items.length > 0
          ? record.items.map((i) => ({
              key: nextKey++,
              name: i.name,
              // null は「未確定」なので空欄のまま出す（"null" と書かない）
              amount: i.amountYen === null ? "" : String(i.amountYen),
            }))
          : [emptyRow()],
      );
    }
  }

  function patch(key: number, next: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  /**
   * コースを明細に1タップで入れる。空の行があればそこに入れ、無ければ足す
   * （開いた直後の空行を残したまま2行目に入るのを避ける）。金額は写しなので
   * 入ったあと自由に直せる。
   */
  function addCourse(course: CourseOption) {
    setRows((rs) => {
      const amount = course.priceYen === null ? "" : String(course.priceYen);
      const blank = rs.findIndex(isBlank);
      if (blank !== -1) {
        return rs.map((r, i) => (i === blank ? { ...r, name: course.name, amount } : r));
      }
      if (rs.length >= MAX_ITEMS) return rs;
      return [...rs, { key: nextKey++, name: course.name, amount }];
    });
  }

  // 合計は入力中もその場で出す。DBに合計の列は持たない（明細が唯一の真実）。
  // 空欄の金額は「未確定」として数に出す（読めない文字列も同じ扱い。保存時に弾かれる）
  const summary = summarizeAmounts(
    rows
      .filter((r) => !isBlank(r))
      .map((r) => ({ amountYen: r.amount.trim() === "" ? null : parseYen(r.amount) })),
  );

  function handleSave() {
    const placeId = hasPlaces && /^\d+$/.test(placeChoice) ? Number(placeChoice) : null;
    const freeText = !hasPlaces || placeChoice === FREE ? placeText.trim() || null : null;
    startTransition(async () => {
      const res = await callAction(() =>
        saveCareVisit({
          id: record?.id,
          kind,
          date,
          time: time.trim() || null,
          placeId,
          place: placeId === null ? freeText : null,
          note: note.trim() || null,
          items: rows.map((r) => ({ name: r.name, amount: r.amount })),
        }),
      );
      if (res.ok) {
        toast.success(
          record
            ? "記録を更新しました"
            : kind === "trimming" && date > today
              ? "トリミングの予約を記録しました"
              : `${label}を記録しました`,
        );
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
          <DialogDescription>{words.description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{words.dateLabel}</span>
              {/* value が YYYY-MM-DD でスキーマと同形 — 変換を挟まない */}
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">時間（任意）</span>
              {/* value は HH:MM。date と同じく文字列のまま保存する */}
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-32 tabular-nums"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="care-place" className="text-sm font-medium">
              {words.placeLabel}
            </label>
            {hasPlaces ? (
              <>
                <select
                  id="care-place"
                  value={placeChoice}
                  onChange={(e) => setPlaceChoice(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">指定しない</option>
                  {places.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                  <option value={FREE}>その他（自由入力）</option>
                </select>
                {placeChoice === FREE && (
                  <Input
                    value={placeText}
                    onChange={(e) => setPlaceText(e.target.value)}
                    placeholder={words.placePlaceholder}
                    aria-label={`${words.placeLabel}の名前`}
                  />
                )}
              </>
            ) : (
              <>
                <Input
                  id="care-place"
                  value={placeText}
                  onChange={(e) => setPlaceText(e.target.value)}
                  placeholder={words.placePlaceholder}
                />
                <span className="text-xs text-muted-foreground">{words.placeHint}</span>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">明細</span>
              <span className="ml-auto text-sm tabular-nums">
                合計 {summary.knownCount === 0 ? "—" : formatYen(summary.totalYen)}
                {summary.unknownCount > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    （未確定 {summary.unknownCount}行）
                  </span>
                )}
              </span>
            </div>

            {courses.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">コースから追加:</span>
                {courses.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => addCourse(c)}
                  >
                    {c.name}
                    {c.priceYen !== null && (
                      <span className="text-muted-foreground tabular-nums">
                        {formatYen(c.priceYen)}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            )}

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
                    placeholder="金額（空欄可）"
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
