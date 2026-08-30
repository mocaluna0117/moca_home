import { addDays, daysInMonth, isDateOnly, parseYearMonth, type DateStr, type YearMonth } from "./calendar";

/**
 * フィラリア予防薬の予定日を作る／リマインドする対象を選ぶ、純粋なロジック。
 *
 * 日付はすべて DATE ONLY の 'YYYY-MM-DD'。今日の日付は呼び出し側から渡す
 * （この関数群をテストで固定できるようにするため）。
 */

/** 一度に作れる予定の上限。指定ミスで何百件も作らないための安全弁 */
export const MAX_GENERATED = 36;

export interface SchedulePlan {
  /** 開始月 'YYYY-MM' */
  startMonth: YearMonth;
  /** 終了月 'YYYY-MM'（この月を含む） */
  endMonth: YearMonth;
  /** 毎月の何日か。1〜31 */
  dayOfMonth: number;
}

export type PlanError =
  | "invalid-month"
  | "invalid-day"
  | "reversed"
  | "too-many";

/**
 * 「5月〜11月の毎月15日」から予定日の一覧を作る。
 *
 * 31日を指定した月に31日が無い場合は **その月の末日に寄せる**（飛ばさない）。
 * 予防は月1回続けることに意味があるので、1か月抜けるほうが困るため。
 */
export function generateDoseDates(
  plan: SchedulePlan,
): { ok: true; dates: DateStr[] } | { ok: false; error: PlanError } {
  const start = parseYearMonth(plan.startMonth);
  const end = parseYearMonth(plan.endMonth);
  if (start === null || end === null) return { ok: false, error: "invalid-month" };
  if (!Number.isInteger(plan.dayOfMonth) || plan.dayOfMonth < 1 || plan.dayOfMonth > 31) {
    return { ok: false, error: "invalid-day" };
  }
  if (end < start) return { ok: false, error: "reversed" };

  const dates: DateStr[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(5, 7));

  while (year < endYear || (year === endYear && month <= endMonth)) {
    if (dates.length >= MAX_GENERATED) return { ok: false, error: "too-many" };
    // 末日に寄せる。2月31日のような日付を作らない
    const day = Math.min(plan.dayOfMonth, daysInMonth(year, month));
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (isDateOnly(date)) dates.push(date);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { ok: true, dates };
}

export interface DoseRow {
  id: number;
  scheduledDate: DateStr;
  /** 実際に飲ませた日。null なら未実施 */
  givenDate: DateStr | null;
  /** リマインドを送った時刻（ISO）。null なら未送信 */
  remindedAt: string | null;
}

/** cron が動かなかった日を取り戻すため、何日前まで遡って送るか */
export const REMIND_LOOKBACK_DAYS = 7;

/**
 * 今日の時点で「リマインドを送るべき予定」を選ぶ。
 *
 * - すでに飲ませた記録があるものは送らない
 * - すでに送ったものは送らない（remindedAt で二重送信を防ぐ）
 * - 予定日が未来のものは送らない
 * - cron が止まっていた日を取り戻すため、数日前までの未送信ぶんは拾う。
 *   ただし遡りすぎると「3か月前の予定」が突然届くので上限を設ける
 */
export function selectDosesToRemind(
  doses: readonly DoseRow[],
  today: DateStr,
  lookbackDays: number = REMIND_LOOKBACK_DAYS,
): DoseRow[] {
  if (!isDateOnly(today)) return [];
  const floor = addDays(today, -Math.max(0, lookbackDays));
  return doses
    .filter(
      (d) =>
        d.givenDate === null &&
        d.remindedAt === null &&
        isDateOnly(d.scheduledDate) &&
        d.scheduledDate <= today &&
        d.scheduledDate >= floor,
    )
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : a.id - b.id));
}

/** 予定の状態。画面の表示分けに使う */
export type DoseStatus = "given" | "today" | "overdue" | "upcoming";

export function doseStatus(dose: Pick<DoseRow, "scheduledDate" | "givenDate">, today: DateStr): DoseStatus {
  if (dose.givenDate !== null) return "given";
  if (dose.scheduledDate === today) return "today";
  return dose.scheduledDate < today ? "overdue" : "upcoming";
}
