"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/", label: "購入履歴" },
  { href: "/calendar", label: "カレンダー" },
  { href: "/favorites", label: "お気に入り" },
] as const;

/** ヘッダーのセクション切替。アプリのトップレベルは購入履歴とカレンダーの2つ。 */
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
              "rounded-md px-2 py-1 text-sm transition-colors",
              active
                ? "font-semibold text-foreground"
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
