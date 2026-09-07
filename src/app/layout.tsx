import type { Metadata } from "next";
import { Hachi_Maru_Pop } from "next/font/google";
import { cookies } from "next/headers";
import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";
import { TopNav } from "@/components/top-nav";
import { SyncButton } from "@/components/sync-button";
import { BackToTop } from "@/components/back-to-top";
import { Toaster } from "@/components/ui/sonner";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";
import { getCatalogState, getLastSync, getStats } from "@/lib/queries";
import { formatSyncedAt } from "@/lib/format";
import "./globals.css";

/**
 * アプリ名と見出しに使う手書き風フォント。
 *
 * 日本語は字数が多くファイルが大きいので preload しない（preload するには
 * subsets の指定が要るが、日本語サブセットは全部入りに近く重い）。
 * display: "swap" にしてあるので、読み込み前はシステムフォントで出て、
 * 届いたら差し替わる。文字が消える時間は作らない。
 */
const cuteFont = Hachi_Maru_Pop({
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-hachi-maru-pop",
});

export const metadata: Metadata = {
  title: "もかのほーむ",
  description: "もかの毎日の記録と、20&20 の購入履歴をまとめて見る",
  applicationName: "もかのほーむ",
  appleWebApp: { title: "もかのほーむ" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The login page renders inside this layout too — skip the header (and the
  // queries behind it) until there is a valid session.
  const gated = Boolean(process.env.APP_PASSWORD);
  const authed =
    !gated ||
    (await isValidSession((await cookies()).get(SESSION_COOKIE)?.value));

  // The catalog sweep takes ~30 min — far past any serverless limit, so the
  // button is CLI-only once deployed.
  const catalogSyncAvailable = !process.env.VERCEL;

  /*
    getCatalogState は**2文を直列**で撃つのに、本番で読むところが無い —
    使うのは下の catalogSyncAvailable && のボタンだけで、あれは Vercel では
    必ず false になる。DB は東京、関数も東京だが、1文はやはり往復1回なので
    「誰も読まない2往復」を毎回の初回表示に乗せない。
    （タブ移動ではこのレイアウトは再描画されないので、効くのは初回表示と
      再読み込みのとき。getCatalogState 自体は /orders と /orders/[id] が
      別の用途で使うので消さない）
  */
  const [lastSync, stats, catalogState] = authed
    ? await Promise.all([
        getLastSync(),
        getStats(),
        catalogSyncAvailable ? getCatalogState() : Promise.resolve(null),
      ])
    : [null, null, null];

  return (
    <html lang="ja" className={`${cuteFont.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {authed && (
          <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Link href="/" className="font-cute text-lg tracking-tight">
                もかのほーむ
              </Link>
              <TopNav />
              {/*
                タブが5本になり、電話ではヘッダーが2行に折り返す。同期の時刻は
                同期ボタンを押す直前に見るものではないので、狭い画面では隠して
                タブに幅を譲る（sm 以上では今までどおり出る）。
              */}
              <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
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
        {/*
          ログイン画面は1画面ぶんしか無くスクロールしないので出さない
          （ヘッダーと同じ「入ったあとの外枠」として認証の内側に置く）。
        */}
        {authed && <BackToTop />}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
