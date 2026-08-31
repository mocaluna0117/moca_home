import Link from "next/link";
import {
  ChevronRight,
  Pill,
  Scissors,
  Syringe,
  UtensilsCrossed,
} from "lucide-react";

/**
 * 【はじめかた】。「次の予定」と「最近のごはん」が**両方空**のとき、その2つを
 * 置き換える1枚（差し替えの判定は showGettingStarted が持つ）。
 *
 * 2つの空状態をそのまま描くと、同じ寸法の破線ボックスが縦に2つ並んで
 * 「壊れている」ように見える。1枚に畳んで、代わりに次の一手を並べる。
 *
 * ここに MealDayDialog は置かない（入力の入口はヒーローの「今日を記録」1つ）。
 * ごはんの行はカレンダーへ運ぶだけにして、同じ下書きの編集口を増やさない。
 */
const STEPS = [
  { href: "/calendar", label: "ごはんを記録する", Icon: UtensilsCrossed },
  { href: "/care?tab=heartworm", label: "フィラリアの予定をつくる", Icon: Pill },
  {
    href: "/calendar?tab=vaccination",
    label: "ワクチンの記録を入れる",
    Icon: Syringe,
  },
  { href: "/care", label: "トリミングを記録する", Icon: Scissors },
] as const;

export function GettingStarted() {
  return (
    // 破線 = このアプリでの「まだ空」の記号（care-section / heartworm-section と同じ形）
    <section className="rounded-lg border border-dashed p-6">
      <h2 className="font-heading text-sm font-medium">はじめかた</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        記録がまだありません。よく使うところから開けます。
      </p>
      {/*
        ol にするのは順番に意味があるから（毎日触るごはんが先、ケアは後）。
        ただし番号は振らない — 上から順にやらないと駄目な手順ではなく、
        「よく使う順」なので、番号は要らない義務感を作ってしまう。
        text-center にしないのも同じ理由で、リンクの並びは左端が揃っている方が
        目と親指の両方で追える。
      */}
      <ol className="mt-3 flex flex-col">
        {STEPS.map((step) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className="-mx-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/40"
            >
              <step.Icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">{step.label}</span>
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
