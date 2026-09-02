import { NextResponse } from "next/server";

import { applyUsualMeals } from "@/lib/actions-log";
import { runHeartwormReminder } from "@/lib/reminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * SMTP は接続と挨拶で時間を食う。1試行で最大40秒、一時的な失敗のときだけ
 * 5秒空けて1回だけ粘るので、最悪でも90秒前後。Hobby の上限は300秒。
 */
export const maxDuration = 120;

/** safe() が例外を包んだときの形。仕事の側の失敗と同じ読み方ができるようにする */
type Failed = { ok: false; error: string };

/**
 * 片方の仕事が投げても、もう片方は走らせる。
 *
 * cron は Hobby では1日1回しか来ない。例外をそのまま500にすると、
 * 先に走ったほうの失敗で後ろの仕事が丸ごとその日ぶん落ちる。
 * 握り潰さずに結果として返すのは、何が起きたかを cron のログで追えるようにするため。
 */
async function safe<T>(run: () => Promise<T>): Promise<T | Failed> {
  try {
    return await run();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 1日1回の定期実行。いつものご飯の記録づくりとフィラリアのリマインドを
 * まとめて走らせる。Vercel Cron が叩く（vercel.json）。
 *
 * **認証は middleware で済んでいる。** middleware は CRON_PATH のときだけ
 * Authorization: Bearer $CRON_SECRET を検証して通す。matcher からは
 * 外していない（外すと認証ゲートの外にURLが増える）。
 *
 * 手で叩いて確かめるときも同じヘッダが要る:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/daily
 */
export async function GET() {
  // 先に食事。SMTP は最悪90秒近く粘るので、120秒の上限に食われて
  // その日の記録を落とさない。片方が失敗しても他方は走らせる
  const meals = await safe(() => applyUsualMeals());
  const reminder = await safe(() => runHeartwormReminder());
  // 結果に予定日や薬名は入れない。cron のログは自分で見るものだが、
  // わざわざ増やす理由もない
  return NextResponse.json({ meals, reminder }, { headers: { "Cache-Control": "no-store" } });
}
