import { randomUUID } from "node:crypto";

import { addDays, todayJst, type DateStr } from "./calendar";
import { REMIND_LOOKBACK_DAYS, selectDosesToRemind, type DoseRow } from "./heartworm";
import {
  buildReminderBody,
  buildReminderSubject,
  isRetryable,
  type RemindError,
  type ReminderDose,
} from "./mail-config";

/**
 * フィラリアのリマインドを1回分走らせる手順。
 *
 * DB とメールは引数で受け取る（本物を渡すのは src/lib/reminder.ts）。
 * server-only も DB の接続も import しないので、時刻を止めたまま
 * 2本を同時に走らせるテストが書ける（reminder-run.test.ts）。
 */

export interface ReminderResult {
  today: DateStr;
  /** 送るべきだった件数 */
  due: number;
  /** 実際に送れた件数 */
  sent: number;
  reason?: "not-configured" | RemindError;
}

/** 予約できた行。メールの文面に要る列だけ */
export interface ReservedDose extends ReminderDose {
  id: number;
}

/**
 * reminded_at の読み書き。本物の SQL は src/lib/reminder.ts にある。
 * 予約より後の操作は、どれも **reminded_at が mark と一致する行だけ** を触る。
 */
export interface ReminderStore {
  /** 候補を粗く引く（判定の正解は selectDosesToRemind が持つ） */
  candidates(floor: DateStr, today: DateStr): Promise<DoseRow[]>;
  /** ids のうち reminded_at が NULL の行にだけ mark を書く */
  reserve(ids: number[], mark: string, now: string): Promise<void>;
  /** reminded_at が mark と一致する行（＝この実行が予約できた行） */
  reserved(mark: string): Promise<ReservedDose[]>;
  /** 送れなかった。mark の行の予約を NULL に戻し、理由を残す */
  release(mark: string, reason: RemindError, now: string): Promise<void>;
  /** 送れた。mark の行に残っていた失敗理由を消す */
  markSent(mark: string, now: string): Promise<void>;
}

export type SendResult = { ok: true } | { ok: false; reason: RemindError };

export interface ReminderDeps {
  store: ReminderStore;
  /** 今の時刻（+09:00 付き ISO。本物は nowJstIso） */
  now: () => string;
  mailConfigured: boolean;
  send: (mail: { subject: string; text: string }) => Promise<SendResult>;
  /** 本文の末尾に載せるアプリの URL */
  appUrl?: string;
  /** 再送までの待ち。テストでは待たない */
  sleep?: (ms: number) => Promise<void>;
}

/** 一時的な失敗のとき、再送までに空ける時間 */
const RETRY_DELAY_MS = 5_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 予約の印（reminded_at に書く値）。**実行ごとに必ず違う値にする。**
 *
 * 時刻だけを印にすると、nowJstIso() は秒までしか持たないので、同じ秒に
 * 始まった2本（Vercel cron の再試行と手動の呼び出しなど）の印が一致し、
 * 後から来たほうが先の予約を自分のものと取り違えて同じメールを送る。
 * そこで実行ごとの ID（UUID）を後ろに付ける。
 *
 * 先頭は +09:00 付き ISO の時刻のまま残す
 * （例 "2026-08-31T08:00:00+09:00#3b241101-e2bb-4255-8caf-4136c566a962"）。
 * reminded_at を読む側は NULL かどうかしか見ていないが、先頭10文字を
 * 日付として読む todayJst / formatDate のような読み方も壊れない。
 */
export function reminderMark(stamp: string, runId: string = randomUUID()): string {
  return `${stamp}#${runId}`;
}

/**
 * 二重送信を防ぐ組み立て:
 *  1. 候補を粗く引く（判定の正解は selectDosesToRemind が持つ）
 *  2. **送る前に** reminded_at にこの実行の印を書いて予約する。
 *     予約は reminded_at IS NULL の行だけを更新するので、cron が二重に
 *     走っても同じ行を予約できるのは1本だけ
 *  3. 予約できた行（reminded_at が自分の印と一致する行）だけを送る
 *  4. 送信に失敗したら予約を **戻す**。戻さないと「送ったことになっている
 *     のに届いていない」日が黙って生まれる。理由は remind_error に残す
 */
export async function runReminder(deps: ReminderDeps): Promise<ReminderResult> {
  const { store, send } = deps;
  const stamp = deps.now();
  const today = todayJst(stamp);
  const floor = addDays(today, -REMIND_LOOKBACK_DAYS);

  // 1. 候補を引いて絞る
  const due = selectDosesToRemind(await store.candidates(floor, today), today);
  if (due.length === 0) return { today, due: 0, sent: 0 };

  if (!deps.mailConfigured) {
    return { today, due: due.length, sent: 0, reason: "not-configured" };
  }

  // 2. 予約する。印はこの実行だけのもの
  const mark = reminderMark(stamp);
  await store.reserve(
    due.map((d) => d.id),
    mark,
    stamp,
  );

  // 3. 自分の印が付いた行だけ。同じ秒の別の実行が予約した行は入らない
  const reserved = await store.reserved(mark);
  if (reserved.length === 0) return { today, due: due.length, sent: 0 };

  const subject = buildReminderSubject(reserved, today);
  const text = buildReminderBody(reserved, today, deps.appUrl);

  let result = await send({ subject, text });
  // 一時的な失敗のときだけ、その場で1回だけ粘る。恒久エラーで叩き続けない
  if (!result.ok && isRetryable(result.reason)) {
    await (deps.sleep ?? wait)(RETRY_DELAY_MS);
    result = await send({ subject, text });
  }

  if (!result.ok) {
    // 4. 予約を戻す。戻すのも自分の印の行だけ（別の実行が送った行を消さない）
    await store.release(mark, result.reason, deps.now());
    return { today, due: due.length, sent: 0, reason: result.reason };
  }

  await store.markSent(mark, deps.now());
  return { today, due: due.length, sent: reserved.length };
}
