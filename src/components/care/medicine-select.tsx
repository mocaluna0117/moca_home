"use client";

import { cn } from "@/lib/utils";

export interface MedicineOption {
  id: number;
  name: string;
}

/**
 * 薬を選ぶ欄。ネイティブの select を使う。
 *
 * 候補は数個〜十数個で検索は要らず、スマホでは OS のホイールが出るほうが
 * 速い。ライブラリを増やす理由がないので Input と同じ見た目だけ揃える。
 */
export function MedicineSelect({
  value,
  onChange,
  options,
  emptyHint,
  id,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  options: MedicineOption[];
  /** 候補が1つも無いときに出す案内 */
  emptyHint?: string;
  id?: string;
}) {
  if (options.length === 0 && emptyHint) {
    return <p className="text-xs text-muted-foreground">{emptyHint}</p>;
  }
  return (
    <select
      id={id}
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className={cn(
        "h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
    >
      <option value="">選択しない</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
