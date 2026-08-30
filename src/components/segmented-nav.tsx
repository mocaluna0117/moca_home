import Link from "next/link";

import { cn } from "@/lib/utils";

/** URL 駆動のセグメントタブ。ui/tabs.tsx は client + 内部 state なので使わない。 */
export function SegmentedNav({
  items,
  current,
}: {
  items: { value: string; label: string; href: string }[];
  current: string;
}) {
  return (
    <nav className="inline-flex w-fit rounded-lg bg-muted p-1" aria-label="表示切替">
      {items.map((item) => (
        <Link
          key={item.value}
          href={item.href}
          scroll={false}
          aria-current={current === item.value ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            current === item.value
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
