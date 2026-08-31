"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/", label: "購入履歴" },
  { href: "/calendar", label: "カレンダー" },
  { href: "/care", label: "ケア" },
  { href: "/favorites", label: "お気に入り" },
] as const;

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
    <nav className="flex items-center gap-1" aria-label="セクション">
      {SECTIONS.map((s) => {
        const active =
          s.href === "/" ? pathname === "/" : pathname.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={cn(
              // Hachi Maru Pop は weight 400 しかないので、font-semibold を足すと
              // ブラウザの合成擬似ボールドになりアプリ名と描画が揃わない。
              // アクティブは色差だけで示す。
              "rounded-md px-2 py-1 font-cute text-sm transition-colors",
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
