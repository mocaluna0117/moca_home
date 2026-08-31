import { NextResponse } from "next/server";

import { runHeartwormReminder } from "@/lib/reminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * SMTP は接続と挨拶で時間を食う。1試行で最大40秒、一時的な失敗のときだけ
 * 5秒空けて1回だけ粘るので、最悪でも90秒前後。Hobby の上限は300秒。
 */
export const maxDuration = 120;

/**
 * フィラリアのリマインド。Vercel Cron が1日1回叩く（vercel.json）。
 *
 * **認証は middleware で済んでいる。** middleware は CRON_PATH のときだけ
 * Authorization: Bearer $CRON_SECRET を検証して通す。matcher からは
 * 外していない（外すと認証ゲートの外にURLが増える）。
 *
 * 手で叩いて確かめるときも同じヘッダが要る:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/heartworm
 */
export async function GET() {
  const result = await runHeartwormReminder();
  // 結果に予定日や薬名は入れない。cron のログは自分で見るものだが、
  // わざわざ増やす理由もない
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
