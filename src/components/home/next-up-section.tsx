import Link from "next/link";
import { CalendarDays, Pill, Scissors, Syringe } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatDayLabel } from "@/lib/calendar";
import type { ScheduleKind, ScheduleRow } from "@/lib/home";
import { cn } from "@/lib/utils";

/** 種類ごとの記号。【0】バンドと【はじめかた】でも同じ記号を使う（語彙を1つに保つ） */
const KIND_ICON: Record<ScheduleKind, typeof Pill> = {
  heartworm: Pill,
  vaccination: Syringe,
  trimming: Scissors,
};

/**
 * 【2】次の予定。**常に3行・順序固定**（フィラリア → ワクチン → トリミング）。
 *
 * 行の状態（due / estimate / observed / unset）は buildHomeSchedule が決めきり、
 * date・relative・fallback・detail のどれが埋まっているかで描き方まで決まっている
 * （src/lib/home.ts の ScheduleRow の doc を参照）。ここは分岐して並べるだけで、
 * 「そろそろ」かどうかも「あと何日」かも計算しない。
 */
export function NextUpSection({ rows }: { rows: ScheduleRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading inline-flex items-center gap-1.5 text-sm font-medium">
        <CalendarDays className="size-4" aria-hidden="true" />
        次の予定
      </h2>
      {/*
        電話は1枠の中に divide-y で3行、デスクトップは独立した3セル。
        3行を消して2行にはしない — 何が未設定かが見えるほうが価値が高い。
      */}
      <ul className="divide-y overflow-hidden rounded-lg border sm:grid sm:grid-cols-3 sm:gap-3 sm:divide-y-0 sm:rounded-none sm:border-0">
        {rows.map((row) => {
          const Icon = KIND_ICON[row.kind];

          return (
            <li key={row.kind} className="sm:rounded-lg sm:border">
              {row.state === "unset" ? (
                /*
                  記録が0件の種類。「登録してください」を毎日2行のピッチで
                  言い続けないよう、種類名を含んだ1文だけに畳む（文は
                  UNSET_TEXT が持っている）。3種すべて unset の日は
                  ページが【はじめかた】に差し替えるので、ここが催促を
                  引き受ける必要はない。

                  1文でも Link で包む。unsetRow も href を持っている
                  （SCHEDULE_HREF）し、行き先はまさに「登録する場所」なので、
                  3行のうち1行だけタップに反応しないのは説明できない。
                  padding は Link 側に置く（p に持たせると二重になる）。
                */
                <Link
                  href={row.href}
                  className="block p-3 text-xs text-muted-foreground transition-colors hover:bg-muted/30"
                >
                  {row.fallback}
                </Link>
              ) : (
                <Link
                  href={row.href}
                  className="block p-3 transition-colors hover:bg-muted/30"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="size-4" aria-hidden="true" />
                    {row.label}
                    {/*
                      観測から出した数字に予定のふりをさせないための札。
                      トリミングだけが estimate になる。
                    */}
                    {row.state === "estimate" && (
                      <Badge variant="outline" className="font-normal">
                        目安
                      </Badge>
                    )}
                  </span>

                  {row.date !== null ? (
                    <span className="mt-1 block text-sm tabular-nums">
                      {formatDayLabel(row.date)}
                      {row.relative !== null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.relative}
                        </span>
                      )}
                    </span>
                  ) : (
                    // 日付を語れない行（目安が過ぎている = 「そろそろの時期です」）。
                    // observed は fallback を持たないので、この行ごと出ない
                    row.fallback !== null && (
                      <span className="mt-1 block text-sm">{row.fallback}</span>
                    )
                  )}

                  {row.detail !== null && (
                    /*
                      observed（トリミング1〜3件）は date も fallback も持たない
                      ので、この行が1行目の直下に来る。2行目があるときは既に
                      mt-1 で開いているため詰める（mt-0.5）が、無いときは
                      ほかの2枚と行の間隔が揃うように mt-1 を取る。
                    */
                    <span
                      className={cn(
                        "block text-xs text-muted-foreground",
                        row.date === null && row.fallback === null
                          ? "mt-1"
                          : "mt-0.5",
                      )}
                    >
                      {row.detail}
                    </span>
                  )}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
