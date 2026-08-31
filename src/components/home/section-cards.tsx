import Link from "next/link";
import { CalendarDays, HeartPulse, ShoppingBag, Star } from "lucide-react";

/**
 * 【5】ほかのページ。**データを1件も取らない**ので、DB が空の初回起動でも
 * 4枚そろって出る。ページの下端がいつも埋まっていることが「壊れていない」
 * 感の主因になる。
 *
 * 件数を出さないのは、同じ数字を2箇所に置くと片方だけ直す日が来るから
 * （数字は上の3ブロックが持つ）。中に interactive を1つも置かないので、
 * カード全面を素の Link で包める（order-card.tsx の stretched-link は不要）。
 */
const CARDS = [
  {
    href: "/orders",
    label: "購入履歴",
    description: "20&20 で買ったもの",
    Icon: ShoppingBag,
  },
  {
    href: "/calendar",
    label: "カレンダー",
    description: "毎日のごはんとおやつ",
    Icon: CalendarDays,
  },
  {
    href: "/care",
    label: "ケア",
    description: "フィラリア・トリミング・通院",
    Icon: HeartPulse,
  },
  {
    href: "/favorites",
    label: "お気に入り",
    description: "気になっている商品",
    Icon: Star,
  },
] as const;

export function SectionCards() {
  return (
    <nav aria-label="ほかのページ" className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-medium">ほかのページ</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/30"
          >
            <c.Icon className="size-5 text-muted-foreground" aria-hidden="true" />
            <span className="font-heading text-sm">{c.label}</span>
            <span className="text-xs text-muted-foreground">{c.description}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
