import { Cake, CalendarDays, PawPrint } from "lucide-react";

import { MealDayDialog } from "@/components/calendar/meal-day-dialog";
import { ProfileFrame } from "@/components/home/profile-frame";
import { Card, CardContent } from "@/components/ui/card";
import { formatDayLabel } from "@/lib/calendar";
import type { HomeHero } from "@/lib/queries-home";
import { cn } from "@/lib/utils";

/**
 * ホームのヒーロー「今日のもか」。ページで一番大きいブロック。
 *
 * 文字列はすべて getHomeSnapshot（= src/lib/profile.ts の純関数）が
 * 作り終えた状態で降りてくる。ここに残る整形は formatDayLabel(today) と
 * アイコンの選択だけ — 年齢や記念日の計算をここに置くと、同じ判定が
 * サーバとコンポーネントの2箇所に生えるため。
 *
 * 写真とプロフィール編集だけが client（ProfileFrame）で、テキスト列は
 * children として渡す。こうするとヒーロー本体は Server のまま、
 * client 境界は「onError を持つ img」と「ダイアログの open state」に閉じる。
 */

/**
 * 純モジュールは "cake" | "paw" という文字列だけを返す（コンポーネントを
 * 返せない）。文字列とアイコンの対応を知っているのはここ1箇所。
 */
const HIGHLIGHT_ICON = { cake: Cake, paw: PawPrint } as const;

export function MocaHero({
  today,
  name,
  meta,
  highlight,
  note,
  weight,
  mealLines,
  todayDraft,
  previousDate,
  profile,
  photoSrc,
  blobEnabled,
}: HomeHero) {
  const HighlightIcon = highlight ? HIGHLIGHT_ICON[highlight.icon] : null;

  return (
    <Card>
      <CardContent>
        <ProfileFrame
          profile={profile}
          photoSrc={photoSrc}
          blobEnabled={blobEnabled}
          today={today}
        >
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatDayLabel(today)}
          </p>
          {/*
            font-weight クラスを一切付けない。Tailwind preflight が h1 に
            font-weight: inherit を当てているので 400 のまま描かれる —
            Hachi Maru Pop は 400 しか無く、太らせると合成擬似ボールドになる。
            主役はサイズ（text-2xl/3xl）と写真で作る。
          */}
          <h1 className="font-cute text-2xl leading-tight sm:text-3xl">{name}</h1>
          {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
          {/*
            行が無いときだけ出す1行。空の項目に「—」を並べる代わりに、
            プロフィール自体がまだ無いことを1回だけ言う
            （「作る」ボタンは ProfileFrame が children の下に出す）。
          */}
          {profile === null && (
            <p className="text-sm text-muted-foreground">プロフィールがまだありません</p>
          )}
          {highlight && HighlightIcon && (
            <p className="inline-flex items-center gap-1.5 text-sm">
              <HighlightIcon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              {highlight.text}
            </p>
          )}
          {note && <p className="line-clamp-2 text-sm text-muted-foreground">{note}</p>}
          {weight && (
            <p className="text-xs text-muted-foreground tabular-nums">{weight}</p>
          )}
          {/*
            mealLines は常に3行（朝・夜・おやつ）。未記録の行も出すのは、
            形が先に見えれば「何を入れる場所か」が分かるから。
            ラベル幅は MonthAgendaView と同じ w-10 に揃えてある。
          */}
          <ul className="mt-1 flex flex-col gap-1 sm:grid sm:grid-cols-3 sm:gap-3">
            {mealLines.map((line) => (
              <li
                key={line.slot}
                className="flex gap-2 text-sm sm:flex-col sm:gap-0.5"
              >
                <span className="w-10 shrink-0 text-xs text-muted-foreground sm:w-auto">
                  {line.label}
                </span>
                {/* line-clamp-1 + min-w-0 で長い商品名でも横に伸びない */}
                <span
                  className={cn(
                    "min-w-0 flex-1 line-clamp-1 leading-snug",
                    line.empty && "text-muted-foreground",
                  )}
                >
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
          {/*
            ページ唯一の MealDayDialog。catalog-picker と ProductSearchDialog を
            ホームのバンドルに引き込むが、飼い主は1日2回ここを触るので
            その分は払う価値がある（「最近のごはん」側には置かない）。
          */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <MealDayDialog
              draft={todayDraft}
              previousDate={previousDate}
              triggerVariant="default"
              // ページで一番押される1つ。既定の "sm" は h-7（28px）で、
              // 親指の目安（44px）を大きく下回る。ダイアログが持つ2値のうち
              // 大きい方（h-8）を明示して取れるだけ取る
              triggerSize="default"
              trigger={
                <>
                  <CalendarDays aria-hidden="true" />
                  今日を記録
                </>
              }
            />
          </div>
        </ProfileFrame>
      </CardContent>
    </Card>
  );
}
