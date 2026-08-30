/**
 * カレンダー機能の日付計算。DB も React も import しない純モジュール
 * （bonus.ts / core-name.ts と同じく tsx --test で単体実行できるように）。
 *
 * 日付は "YYYY-MM-DD"（JST の暦日）の文字列だけを扱い、Date オブジェクトを
 * 跨がせない。暦日は「瞬間」ではないので、タイムゾーン変換を一度も通さない
 * ことで日付が1日ずれる事故（format.ts の nowJstIso() のコメント参照）が
 * 構造的に起きなくなる。文字列の辞書順 = 時系列順。
 */

export const MEAL_SLOTS = ["morning", "evening", "treat"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** 表示順は 朝 → 夜 → おやつ で固定（おやつは時刻を持たないため末尾） */
export const SLOT_LABEL: Record<MealSlot, string> = {
  morning: "朝",
  evening: "夜",
  treat: "おやつ",
};

export const SLOT_LABEL_LONG: Record<MealSlot, string> = {
  morning: "朝ごはん",
  evening: "夜ごはん",
  treat: "おやつ",
};

/** "YYYY-MM" */
export type YearMonth = string;
/** "YYYY-MM-DD" */
export type DateStr = string;

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export function isMealSlot(v: unknown): v is MealSlot {
  return typeof v === "string" && (MEAL_SLOTS as readonly string[]).includes(v);
}

/** 書式だけでなく実在する暦日かまで見る（2026-02-30 を弾く）。 */
export function isDateOnly(v: unknown): v is DateStr {
  if (typeof v !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** その年月の日数。month は 1-12。 */
export function daysInMonth(year: number, month: number): number {
  // Date.UTC(y, month, 0) = 前月の末日 = month の末日（month が 1 始まりのため）
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "?m=" の検証。不正なら null（呼び出し側が今月にフォールバックする）。 */
export function parseYearMonth(raw: string | undefined | null): YearMonth | null {
  if (!raw || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return null;
  const y = Number(raw.slice(0, 4));
  return y >= 2000 && y <= 2100 ? raw : null;
}

/** +09:00 付き ISO 文字列から暦日だけを取り出す。now を渡すのでテスト可能。 */
export function todayJst(nowIso: string): DateStr {
  return nowIso.slice(0, 10);
}

export function yearMonthOf(date: DateStr): YearMonth {
  return date.slice(0, 7);
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** 月初と「翌月初」。SQL の date >= start and date < endExclusive に使う。 */
export function monthRange(
  ym: YearMonth,
): { start: DateStr; endExclusive: DateStr } | null {
  if (!parseYearMonth(ym)) return null;
  const next = shiftMonth(ym, 1);
  return { start: `${ym}-01`, endExclusive: `${next}-01` };
}

export function addDays(date: DateStr, n: number): DateStr {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  // UTC で計算すれば DST もローカル TZ も一切影響しない
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0=日 … 6=土。暦日→曜日は TZ 非依存なので UTC で計算してよい。 */
export function weekdayOf(date: DateStr): number {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function formatMonthLabel(ym: YearMonth): string {
  return `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
}

/** "8月12日（火）" */
export function formatDayLabel(date: DateStr): string {
  const mo = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${mo}月${d}日（${WEEKDAY_JA[weekdayOf(date)]}）`;
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_JA[weekday] ?? "";
}

export interface GridDay {
  date: DateStr;
  /** 日にちだけ（1-31） */
  day: number;
  /** その月の日か（前後月のこぼれは false） */
  inMonth: boolean;
  /** 0=日 … 6=土 */
  weekday: number;
}

export interface MonthGrid {
  ym: YearMonth;
  label: string;
  prev: YearMonth;
  next: YearMonth;
  /** 日曜始まりの完全な週の配列。月によって 4〜6 週になる。 */
  weeks: GridDay[][];
}

/**
 * 月グリッド。日曜始まりで、前後の月からこぼれた日も埋めて
 * 常に7の倍数のマスにする（週数は月により 4〜6 で可変 — 42 固定にすると
 * 使わない週が下に残る）。
 */
export function buildMonthGrid(ym: YearMonth): MonthGrid | null {
  if (!parseYearMonth(ym)) return null;
  const first = `${ym}-01`;
  const start = addDays(first, -weekdayOf(first));

  const y = Number(ym.slice(0, 4));
  const mo = Number(ym.slice(5, 7));
  const last = `${ym}-${pad(daysInMonth(y, mo))}`;
  const end = addDays(last, 6 - weekdayOf(last));

  const weeks: GridDay[][] = [];
  let cursor = start;
  while (cursor <= end) {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        date: cursor,
        day: Number(cursor.slice(8, 10)),
        inMonth: cursor.slice(0, 7) === ym,
        weekday: weekdayOf(cursor),
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }

  return {
    ym,
    label: formatMonthLabel(ym),
    prev: shiftMonth(ym, -1),
    next: shiftMonth(ym, 1),
    weeks,
  };
}

/** 食歴のグルーピングキー — getProductSummaries と同じ規約。 */
export const foodKey = (productId: number | null, label: string): string =>
  productId !== null ? `p:${productId}` : `n:${label}`;
