/**
 * リマインドメールの設定と文面を組み立てる純粋なロジック。
 *
 * nodemailer を触る部分（src/lib/mail.ts）とは分けてある。ここは
 * import ゼロでテストできるようにしておきたいため。
 */

/** 送信失敗の理由。生のメッセージは宛先が混ざりうるのでDBには入れない */
export type RemindError = "config" | "auth" | "rejected" | "network" | "unknown";

/** Gmail のアプリパスワードは16桁 */
const APP_PASSWORD_LENGTH = 16;
/** 宛先の上限。設定ミスで大量送信しないための歯止め */
export const MAX_RECIPIENTS = 5;

/**
 * アプリパスワードを正規化する。
 *
 * Google の画面は "abcd efgh ijkl mnop" と4桁ずつ区切って表示するので、
 * 空白入りのままコピーされる。全角空白で貼られることもある。
 */
export function normalizeAppPassword(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.replace(/[\s　]/g, "");
  if (compact.length !== APP_PASSWORD_LENGTH) return null;
  if (!/^[A-Za-z]+$/.test(compact)) return null;
  return compact;
}

/** ざっくりした形の検査。ここで弾くのは打ち間違いであって攻撃者ではない */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(v);
}

/**
 * 宛先の並びを配列にする。カンマ・空白・改行のどれで区切ってもよい。
 * 重複は取り除く（同じ人に2通行かないように）。
 */
export function parseRecipients(raw: string | undefined | null): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\s　]+/)) {
    const value = part.trim();
    if (value === "" || !looksLikeEmail(value)) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.add(key);
    if (seen.size >= MAX_RECIPIENTS) break;
  }
  return [...seen];
}

export interface MailConfig {
  user: string;
  appPassword: string;
  to: string[];
}

/**
 * 環境変数から設定を組み立てる。1つでも欠けたら null。
 * 「未設定なら機能を隠して他は成立させる」という既存方針に合わせる。
 */
export function buildMailConfig(
  env: Readonly<Record<string, string | undefined>>,
): MailConfig | null {
  const user = env.GMAIL_USER?.trim();
  const appPassword = normalizeAppPassword(env.GMAIL_APP_PASSWORD);
  const to = parseRecipients(env.HEARTWORM_MAIL_TO);
  if (!user || !looksLikeEmail(user) || !appPassword || to.length === 0) return null;
  return { user, appPassword, to };
}

export interface ReminderDose {
  scheduledDate: string;
  label: string | null;
}

function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : date;
}

/**
 * 件名。**日付を必ず入れる。**
 * 毎回同じ件名だと Gmail が1つのスレッドにまとめてしまい、
 * 2通目以降が畳まれて気づけなくなる。
 */
export function buildReminderSubject(doses: readonly ReminderDose[], today: string): string {
  if (doses.length === 1 && doses[0].scheduledDate === today) {
    return `【フィラリア】今日 ${formatDate(today)} は投薬日です`;
  }
  if (doses.length === 1) {
    return `【フィラリア】${formatDate(doses[0].scheduledDate)}の投薬がまだです`;
  }
  return `【フィラリア】未投薬が${doses.length}件あります（${formatDate(today)}時点）`;
}

/**
 * 本文。宛先は本人と家族なので、日付と薬名は入れてよい。
 * 住所や口座のような情報は元々どこにも無い。
 */
export function buildReminderBody(
  doses: readonly ReminderDose[],
  today: string,
  appUrl?: string,
): string {
  const lines: string[] = [];
  lines.push("フィラリア予防薬の投薬日です。");
  lines.push("");
  for (const d of doses) {
    const when = d.scheduledDate === today ? "今日" : formatDate(d.scheduledDate);
    const what = d.label ? `（${d.label}）` : "";
    lines.push(`・${when} 予定${what}`);
  }
  lines.push("");
  lines.push("飲ませたらアプリで記録してください。記録すると次回から通知は止まります。");
  if (appUrl) {
    lines.push("");
    lines.push(appUrl);
  }
  lines.push("");
  lines.push("――");
  lines.push("もかのほーむ からの自動送信です。");
  return lines.join("\n");
}

/**
 * SMTP の失敗を、DBに残してよい範囲の分類に落とす。
 * nodemailer のメッセージ全文は宛先を含むので保存しない。
 */
export function classifySmtpError(err: unknown): RemindError {
  const code = String(
    (err as { code?: unknown })?.code ?? (err as { responseCode?: unknown })?.responseCode ?? "",
  ).toUpperCase();
  if (code === "EAUTH" || code === "535" || code === "534") return "auth";
  if (code === "EENVELOPE" || code.startsWith("55") || code.startsWith("5")) return "rejected";
  if (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    code === "ECONNREFUSED" ||
    code === "ESOCKET" ||
    code === "EDNS" ||
    code === "ECONNRESET"
  ) {
    return "network";
  }
  return "unknown";
}

/** 翌日に自然と再試行されるので、その場で粘る価値があるのは一時的な失敗だけ */
export function isRetryable(reason: RemindError): boolean {
  return reason === "network";
}
