import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { dogProfile, type DogProfile } from "@/lib/db/schema";
import { PROFILE_ROW_ID } from "@/lib/profile";

/**
 * もかのプロフィールの読み取り。**この2本だけが例外を飲む。**
 *
 * dog_profile は他のテーブルより後から足した1枚で、本番に届く経路は
 * scripts/push-log-tables.ts の PUSH_TABLES 頼み（migrationSteps 3）。
 * / がサイトの入口になった今、その1行を書き忘れただけで
 * `no such table: dog_profile` がヒーローで投げられ、**全ページに
 * 到達できなくなる**。そこまでの代償を払う価値が写真1枚と名前には無い。
 *
 * 劣化後の見た目が「行が無い」= 初回状態と完全に同一なのが、飲んでよい
 * 根拠でもある（emptyStates の 2 と同じヒーローが出るだけ）。
 * 代わりに、本物の DB 障害もここでは黙る — 障害は「プロフィールが消えた」
 * 形で現れると承知しておくこと。書き込み側（actions-profile.ts）は
 * 飲まない。保存の失敗は必ず本人に伝わらなければならない。
 */
export async function getDogProfile(): Promise<DogProfile | null> {
  try {
    return (
      (await db.select().from(dogProfile).where(eq(dogProfile.id, PROFILE_ROW_ID)).get()) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * 配信ルート（/api/dog-photo）用。写真1枚を返すのに要る2列だけ。
 *
 * 行ごと引かないのは、画像リクエストは1ページに1回とはいえヒーローとは
 * 別の往復で、名前や体重をその往復に乗せる理由が無いため。
 * pathname が null の行は「写真が無い」= 呼び出し側は 404 に落とす。
 * getDogProfile と同じ理由で throw しない（画像1枚で 500 を出さない）。
 */
export async function getDogPhoto(): Promise<{
  pathname: string;
  contentType: string | null;
} | null> {
  try {
    const row = await db
      .select({
        pathname: dogProfile.photoPathname,
        contentType: dogProfile.photoContentType,
      })
      .from(dogProfile)
      .where(eq(dogProfile.id, PROFILE_ROW_ID))
      .get();
    return row?.pathname ? { pathname: row.pathname, contentType: row.contentType } : null;
  } catch {
    return null;
  }
}
