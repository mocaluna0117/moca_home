import { GettingStarted } from "@/components/home/getting-started";
import { MocaHero } from "@/components/home/moca-hero";
import { NextUpSection } from "@/components/home/next-up-section";
import { PurchaseSummary } from "@/components/home/purchase-summary";
import { RecentMealsSection } from "@/components/home/recent-meals-section";
import { SectionCards } from "@/components/home/section-cards";
import { UrgentBand } from "@/components/home/urgent-band";
import { getHomeSnapshot } from "@/lib/queries-home";

export const dynamic = "force-dynamic";

/**
 * ホーム。主題は「買い物」ではなく「もか」。
 *
 * 導出はすべて getHomeSnapshot の中で終わっている（この関数に判定を1つも
 * 置かないのが要点 — ブロックが5つあるので、ここで少しでも計算を始めると
 * 「今日」や「前回」の定義がページとライブラリの2箇所に散る）。
 * 購入履歴の一覧・検索・タブは /orders に移したので searchParams は取らない。
 *
 * 注文0件での早期 return も置かない。同期前でもヒーロー・はじめかた・
 * ほかのページは意味を持って描けるし、全画面の空状態は /orders の役目。
 */
export default async function HomePage() {
  const home = await getHomeSnapshot();

  return (
    // 他ページは gap-5。ホームだけ性格の違うセクションが5つ積むので1段広げる
    <div className="flex flex-col gap-6">
      {/* 平常日は DOM に無い。空の警告枠を毎日見せない */}
      {home.urgent.length > 0 && (
        <UrgentBand
          items={home.urgent}
          today={home.today}
          medicines={home.medicines}
        />
      )}

      <MocaHero {...home.hero} />

      {/*
        ケアもごはんも記録が0件のときは、同じ寸法の破線ボックスを2つ
        並べる代わりに【はじめかた】1枚に畳む。
      */}
      {home.showGettingStarted ? (
        <GettingStarted />
      ) : (
        <>
          <NextUpSection rows={home.scheduleRows} />
          <RecentMealsSection days={home.recentDays} />
        </>
      )}

      <PurchaseSummary stats={home.stats} lastSyncedAt={home.lastSyncedAt} />
      <SectionCards />
    </div>
  );
}
