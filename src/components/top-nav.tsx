"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type Section = {
  href: string;
  label: string;
  /**
   * href の下に無いが、このタブに属するパス。
   * /products/[id] は購入履歴の一覧から開く商品ページなので、購入履歴を点ける
   * （移設前は「購入履歴 = /」の完全一致だったため、/products/1 ではどのタブも
   * 点かず、自分がどのセクションに居るのか分からなくなっていた）。
   */
  extraPrefixes?: readonly string[];
};

const SECTIONS: readonly Section[] = [
  { href: "/", label: "ホーム" },
  { href: "/orders", label: "購入履歴", extraPrefixes: ["/products"] },
  { href: "/calendar", label: "カレンダー" },
  { href: "/meals", label: "ごはん" },
  { href: "/trimming", label: "トリミング" },
  { href: "/hospital", label: "通院" },
  { href: "/heartworm", label: "フィラリア" },
  { href: "/medicines", label: "薬" },
  { href: "/vaccinations", label: "接種記録" },
  { href: "/favorites", label: "お気に入り" },
];

/**
 * ヘッダーのセクション切替。
 *
 * **記録の種類ぶんだけタブがある。** かつては「ケア」1本の中に
 * トリミング・通院・フィラリア・薬の4タブ、「カレンダー」の中に
 * いつもの・食べたもの・接種記録の3タブが入れ子になっていた。
 * 2階層目のタブは、ヘッダーからは何があるか見えず、開いてみるまで
 * たどり着けない。10本を横1列に並べて、全部を1タップの距離に置く。
 */
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav
      // タブが10本になり、**デスクトップでも**横に並びきらない（max-w-5xl に
      // 対して和文ラベル10本は入らない）。ヘッダーの2行目を丸ごともらって
      // （order-last w-full）、どの画面幅でも横スクロールにする。アプリ内で
      // 横に動いていい要素はここだけ。折り返しにしないのは、2段になると
      // ヘッダーの高さが画面幅ごとに変わって本文の位置が動くため。
      className="order-last flex w-full flex-nowrap items-center gap-1 overflow-x-auto"
      aria-label="セクション"
    >
      {SECTIONS.map((s) => {
        const active =
          s.href === "/"
            ? pathname === "/"
            : pathname.startsWith(s.href) ||
              (s.extraPrefixes?.some((p) => pathname.startsWith(p)) ?? false);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={cn(
              // Hachi Maru Pop は weight 400 しかないので、font-semibold を足すと
              // ブラウザの合成擬似ボールドになりアプリ名と描画が揃わない。
              // アクティブは色差だけで示す。
              "shrink-0 rounded-md px-2 py-1 font-cute text-sm whitespace-nowrap transition-colors",
              // アクティブはアプリのアイコンと同じピンク。色差だけで示す
              active
                ? "text-brand-pink"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
