import { MARK_ICON, MARK_STYLE } from "@/components/calendar/month-grid";
import { cn } from "@/lib/utils";
import type { MarkIcon, MarkKind } from "@/lib/calendar-marks";

/** 凡例に並べる順。カレンダーのマスの中の並びと同じ（calendar-marks の KIND_RANK） */
const ROWS: { kind: MarkKind; icon: MarkIcon }[] = [
  { kind: "trimming", icon: "scissors" },
  { kind: "hospital", icon: "stethoscope" },
  { kind: "heartworm", icon: "pill" },
  { kind: "vaccination", icon: "syringe" },
];

/**
 * カレンダーの印の凡例（RSC）。
 *
 * 色と記号だけでは「これは通院？ワクチン？」が読めない。マスの中には
 * 種類名まで入れてあるが、狭い画面では文字が小さいので、下に一覧を置いて
 * 色と種類の対応を1回だけ言う。**両ビューの外側**に置くので、
 * 電話でもデスクトップでも同じものが出る。
 *
 * 見た目（色・記号・短い名前）は month-grid.tsx の MARK_STYLE / MARK_ICON を
 * そのまま使う。ここで作り直すと、片方だけ色を替えた日に凡例が嘘になる。
 */
export function MarkLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-dashed px-3 py-2">
      <span className="text-xs text-muted-foreground">カレンダーの印</span>
      {ROWS.map(({ kind, icon }) => {
        const Icon = MARK_ICON[icon];
        const style = MARK_STYLE[kind];
        return (
          <span
            key={kind}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
              style.text,
              style.bg,
            )}
          >
            <Icon className="size-2.5 shrink-0" aria-hidden="true" />
            {style.short}
          </span>
        );
      })}
      {/* 破線は「まだ起きていない」の記号。アプリ全体で同じ意味 */}
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className="inline-block size-3 rounded-full border border-dashed border-muted-foreground/70"
        />
        破線は予定
      </span>
    </div>
  );
}
