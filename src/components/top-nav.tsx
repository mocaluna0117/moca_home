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
  { href: "/care", label: "ケア" },
  { href: "/favorites", label: "お気に入り" },
];

/**
 * ヘッダーのセクション切替。
 *
 * ケアを /calendar のタブにしなかったのは、カレンダーが既に3タブあり
 * 狭い画面で潰れるのと、カレンダーが「その日に何をしたか」の日次ログ、
 * ケアが「いくら使ったか・次はいつか」の管理で、答える問いが違うため。
 */
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav
      // タブが5本になり、電話では横に並びきらない。ヘッダーの2行目を丸ごと
      // もらって（order-last w-full）、そこだけ横スクロールを許す。アプリ内で
      // 横に動いていい要素はここだけ。sm 以上は今までどおり同じ行に収まる。
      className="order-last flex w-full flex-nowrap items-center gap-1 overflow-x-auto sm:order-none sm:w-auto sm:overflow-x-visible"
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
              active
                ? "text-foreground"
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
