import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { heartwormDoses } from "@/lib/db/schema";
import { getReminderCandidates } from "@/lib/queries-care";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { nowJstIso } from "@/lib/format";
import { runReminder, type ReminderResult, type ReminderStore } from "@/lib/reminder-run";

export type { ReminderResult } from "@/lib/reminder-run";

function appUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (base) return `${base.replace(/\/$/, "")}/care`;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}/care` : undefined;
}

/**
 * reminded_at の読み書き。予約より後は、どの文も **reminded_at = mark** で
 * 行を選ぶ。id で選ぶと、同じ行を別の実行が予約していても触ってしまう。
 */
const store: ReminderStore = {
  candidates: getReminderCandidates,

  async reserve(ids, mark, now) {
    await db
      .update(heartwormDoses)
      .set({ remindedAt: mark, updatedAt: now })
      .where(
        and(
          inArray(heartwormDoses.id, ids),
          // SQL の `= NULL` は常に偽。IS NULL でないと1行も予約できない
          isNull(heartwormDoses.remindedAt),
        ),
      )
      .run();
  },

  reserved(mark) {
    return db
      .select({
        id: heartwormDoses.id,
        scheduledDate: heartwormDoses.scheduledDate,
        label: heartwormDoses.label,
      })
      .from(heartwormDoses)
      .where(eq(heartwormDoses.remindedAt, mark))
      .all();
  },

  async release(mark, reason, now) {
    await db
      .update(heartwormDoses)
      .set({ remindedAt: null, remindError: reason, updatedAt: now })
      .where(eq(heartwormDoses.remindedAt, mark))
      .run();
  },

  async markSent(mark, now) {
    await db
      .update(heartwormDoses)
      .set({ remindError: null, updatedAt: now })
      .where(eq(heartwormDoses.remindedAt, mark))
      .run();
  },
};

/**
 * フィラリアのリマインドを1回分実行する（/api/cron/daily から）。
 *
 * 手順と二重送信の防ぎ方は src/lib/reminder-run.ts の runReminder にある。
 * 要点: 送る前に reminded_at へ **この実行だけの印**（時刻＋実行ごとの ID）を
 * reminded_at IS NULL の行にだけ書いて予約し、その印が付いた行だけを送る。
 * 同じ秒に2本走っても、同じ行を予約できるのは1本だけ。
 */
export async function runHeartwormReminder(): Promise<ReminderResult> {
  return runReminder({
    store,
    now: nowJstIso,
    mailConfigured: isMailConfigured(),
    send: sendMail,
    appUrl: appUrl(),
  });
}
