import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { heartwormDoses } from "@/lib/db/schema";
import { addDays, todayJst, type DateStr } from "@/lib/calendar";
import { REMIND_LOOKBACK_DAYS, selectDosesToRemind } from "@/lib/heartworm";
import { getReminderCandidates } from "@/lib/queries-care";
import { buildReminderBody, buildReminderSubject, isRetryable } from "@/lib/mail-config";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { nowJstIso } from "@/lib/format";

export interface ReminderResult {
  today: DateStr;
  /** 送るべきだった件数 */
  due: number;
  /** 実際に送れた件数 */
  sent: number;
  reason?: "not-configured" | "auth" | "rejected" | "network" | "unknown" | "config";
}

function appUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (base) return `${base.replace(/\/$/, "")}/care`;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}/care` : undefined;
}

/**
 * フィラリアのリマインドを1回分実行する。
 *
 * 二重送信を防ぐ組み立て:
 *  1. 候補を粗く引く（判定の正解は selectDosesToRemind が持つ）
 *  2. **送る前に** reminded_at を今の時刻で予約する。
 *     予約は reminded_at IS NULL の行だけを更新するので、cron が二重に
 *     走っても後から来たほうは0行しか取れない
 *  3. 予約できた行（reminded_at が自分の打った時刻と一致する行）だけを送る
 *  4. 送信に失敗したら予約を **戻す**。戻さないと「送ったことになっている
 *     のに届いていない」日が黙って生まれる。理由は remind_error に残す
 */
export async function runHeartwormReminder(): Promise<ReminderResult> {
  const stamp = nowJstIso();
  const today = todayJst(stamp);
  const floor = addDays(today, -REMIND_LOOKBACK_DAYS);

  const candidates = await getReminderCandidates(floor, today);
  const due = selectDosesToRemind(candidates, today);
  if (due.length === 0) return { today, due: 0, sent: 0 };

  if (!isMailConfigured()) {
    return { today, due: due.length, sent: 0, reason: "not-configured" };
  }

  // 2. 予約する
  await db
    .update(heartwormDoses)
    .set({ remindedAt: stamp, updatedAt: stamp })
    .where(
      and(
        inArray(
          heartwormDoses.id,
          due.map((d) => d.id),
        ),
        // SQL の `= NULL` は常に偽。IS NULL でないと1行も予約できない
        isNull(heartwormDoses.remindedAt),
      ),
    )
    .run();

  // 3. 自分が予約できた行だけ。stamp はミリ秒まで入るので取り違えない
  const reserved = await db
    .select({
      id: heartwormDoses.id,
      scheduledDate: heartwormDoses.scheduledDate,
      label: heartwormDoses.label,
    })
    .from(heartwormDoses)
    .where(eq(heartwormDoses.remindedAt, stamp))
    .all();
  if (reserved.length === 0) return { today, due: due.length, sent: 0 };

  const subject = buildReminderSubject(reserved, today);
  const text = buildReminderBody(reserved, today, appUrl());

  let result = await sendMail({ subject, text });
  // 一時的な失敗のときだけ、その場で1回だけ粘る。恒久エラーで叩き続けない
  if (!result.ok && isRetryable(result.reason)) {
    await new Promise((r) => setTimeout(r, 5_000));
    result = await sendMail({ subject, text });
  }

  const ids = reserved.map((r) => r.id);
  if (!result.ok) {
    // 4. 予約を戻す
    await db
      .update(heartwormDoses)
      .set({ remindedAt: null, remindError: result.reason, updatedAt: nowJstIso() })
      .where(inArray(heartwormDoses.id, ids))
      .run();
    return { today, due: due.length, sent: 0, reason: result.reason };
  }

  await db
    .update(heartwormDoses)
    .set({ remindError: null, updatedAt: nowJstIso() })
    .where(inArray(heartwormDoses.id, ids))
    .run();
  return { today, due: due.length, sent: reserved.length };
}
