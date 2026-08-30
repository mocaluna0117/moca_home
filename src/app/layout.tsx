import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { TopNav } from "@/components/top-nav";
import { SyncButton } from "@/components/sync-button";
import { Toaster } from "@/components/ui/sonner";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { getCatalogState, getLastSync, getStats } from "@/lib/queries";
import { formatSyncedAt } from "@/lib/format";
import "./globals.css";

export const metadata: Metadata = {
  title: "20and20 購入履歴",
  description: "20and20 ストアの購入履歴を一覧で確認する",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The login page renders inside this layout too — skip the header (and the
  // queries behind it) until there is a valid session.
  const gated = Boolean(process.env.APP_PASSWORD);
  const authed =
    !gated ||
    (await isValidSession((await cookies()).get(SESSION_COOKIE)?.value));

  const [lastSync, stats, catalogState] = authed
    ? await Promise.all([getLastSync(), getStats(), getCatalogState()])
    : [null, null, null];

  // The catalog sweep takes ~30 min — far past any serverless limit, so the
  // button is CLI-only once deployed.
  const catalogSyncAvailable = !process.env.VERCEL;

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {authed && (
          <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Link href="/" className="font-semibold tracking-tight">
                20and20
              </Link>
              <TopNav />
              <span className="text-xs text-muted-foreground tabular-nums">
                最終同期: {formatSyncedAt(lastSync?.finishedAt)}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {catalogSyncAvailable && (
                  <SyncButton
                    mode="catalog"
                    hasData={catalogState!.lastSweptAt !== null}
                  />
                )}
                <SyncButton hasData={(stats?.orderCount ?? 0) > 0} />
                {gated && <LogoutButton />}
              </div>
            </div>
          </header>
        )}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
          {children}
        </main>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
