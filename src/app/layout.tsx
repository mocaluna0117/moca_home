import type { Metadata } from "next";
import Link from "next/link";

import { SyncButton } from "@/components/sync-button";
import { Toaster } from "@/components/ui/sonner";
import { getLastSync, getStats } from "@/lib/queries";
import { formatSyncedAt } from "@/lib/format";
import "./globals.css";

export const metadata: Metadata = {
  title: "20and20 購入履歴",
  description: "20and20 ストアの購入履歴を一覧で確認する",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const lastSync = getLastSync();
  const stats = getStats();

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              20and20 購入履歴
            </Link>
            <span className="text-xs text-muted-foreground tabular-nums">
              最終同期: {formatSyncedAt(lastSync?.finishedAt)}
            </span>
            <div className="ml-auto">
              <SyncButton hasData={stats.orderCount > 0} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {children}
        </main>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
