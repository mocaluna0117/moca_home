import { isDateOnly, type DateStr } from "./calendar";

/**
 * 接種証明書の読み取り結果を、DB に渡してよい形へ正規化する純関数群。
 *
 * ここが「モデルの出力を信用しない層」。モデルは自由な文字列を返してくるので、
 * - 和暦を西暦へ直す
 * - 実在しない日付・あり得ない範囲を落とす
 * - 個人情報らしき値を落とす
 * を全部この層でやる。**変換に少しでも迷ったら null を返す**。
 * 誤った値がフォームに入るより、空欄のまま人が打つほうが安全なため。
 *
 * 日付は DATE ONLY の 'YYYY-MM-DD'（スキーマと同じ規約。TZ変換を挟まない）。
 */

/**
 * 元号 → その元年の前年（令和N年 = 2018 + N）。
 *
 * 昭和・大正は入れない。isDateOnly() が 2000〜2100 年しか通さないので
 * 変換できても必ず捨てられるうえ、"S"/"T" を元号として拾うと本文中の
 * 英字を誤って年号と読む危険だけが残るため。
 */
const ERAS: ReadonlyArray<{ keys: readonly string[]; base: number }> = [
  { keys: ["令和", "令", "R", "r"], base: 2018 },
  { keys: ["平成", "平", "H", "h"], base: 1988 },
];

/** 次回予定日が今日から何年先までなら妥当か */
const MAX_FUTURE_YEARS = 15;

const PLACEHOLDERS = new Set([
  "",
  "-",
  "ー",
  "―",
  "‐",
  "なし",
  "無し",
  "不明",
  "未記入",
  "空欄",
  "読み取れません",
  "判読不能",
  "null",
  "n/a",
  "N/A",
  "unknown",
]);

/** 住所・電話・メールらしき文字列。証明書には写るが DB には入れない */
const PII_PATTERNS: readonly RegExp[] = [
  /〒/,
  /\d{3}-\d{4}/,
  /\d{2,4}-\d{2,4}-\d{4}/,
  /\+81/,
  /@/,
];

/** 全角数字と記号を半角へ。手書きOCRは全角を返しがち */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／]/g, "/")
    .replace(/[．]/g, ".")
    .replace(/[－−ー―‐]/g, "-")
    .replace(/　/g, " ");
}

interface Ymd {
  year: number;
  month: number;
  /** 「令和9年5月」のように日が無い証明書があるため null を許す */
  day: number | null;
}

function eraBase(marker: string): number | null {
  for (const era of ERAS) {
    if (era.keys.includes(marker)) return era.base;
  }
  return null;
}

/**
 * 文字列から年月日を取り出す。前後に余分な語があっても拾う
 * （モデルが「接種日: 令和8年5月3日」のように返すことがある）。
 */
function findYmd(input: string): Ymd | null {
  const s = toHalfWidth(input).trim();
  if (s === "") return null;

  // 和暦。元年 = 1年。R8.5.3 / 令和8年5月3日 / 令8/5/3 のいずれも拾う
  const wareki = s.match(
    /(令和|令|平成|平|[RrHh])\s*(元|\d{1,2})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:(?:月|[./-])\s*(\d{1,2})\s*日?)?/,
  );
  if (wareki) {
    const base = eraBase(wareki[1]);
    if (base !== null) {
      const eraYear = wareki[2] === "元" ? 1 : Number(wareki[2]);
      if (eraYear >= 1 && eraYear <= 99) {
        return {
          year: base + eraYear,
          month: Number(wareki[3]),
          day: wareki[4] === undefined ? null : Number(wareki[4]),
        };
      }
    }
  }

  // 西暦。2026-05-03 / 2026/5/3 / 2026年5月3日 / 2026-05
  const seireki = s.match(
    /(\d{4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:(?:月|[./-])\s*(\d{1,2})\s*日?)?/,
  );
  if (seireki) {
    return {
      year: Number(seireki[1]),
      month: Number(seireki[2]),
      day: seireki[3] === undefined ? null : Number(seireki[3]),
    };
  }

  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export interface ParsedDate {
  date: DateStr;
  /** 証明書に日が書かれておらず、こちらで1日を補ったか */
  approximate: boolean;
}

/**
 * 和暦・西暦まじりの日付表現を 'YYYY-MM-DD' にする。
 *
 * 日が書かれていない場合の扱いは呼び出し側が決める:
 * - allowMonthOnly=false（接種日）: 日が無ければ null。何日に打ったかは記録の要
 * - allowMonthOnly=true（次回予定日）: 「令和9年5月」が普通なので1日で補う
 */
export function parseCertificateDate(
  input: unknown,
  { allowMonthOnly = false }: { allowMonthOnly?: boolean } = {},
): ParsedDate | null {
  if (typeof input !== "string") return null;
  const ymd = findYmd(input);
  if (ymd === null) return null;

  const approximate = ymd.day === null;
  if (approximate && !allowMonthOnly) return null;

  const date = `${ymd.year}-${pad(ymd.month)}-${pad(ymd.day ?? 1)}`;
  // 2月30日のような実在しない日はここで落ちる
  if (!isDateOnly(date)) return null;
  return { date, approximate };
}

function isPlaceholder(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const text = toHalfWidth(input).replace(/\s+/g, " ").trim();
  return PLACEHOLDERS.has(text) || PLACEHOLDERS.has(text.toLowerCase());
}

function cleanText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") return null;
  const text = toHalfWidth(input)
    .replace(/[「」『』【】]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (PLACEHOLDERS.has(text) || PLACEHOLDERS.has(text.toLowerCase())) return null;
  if (PII_PATTERNS.some((re) => re.test(text))) return null;
  return text.slice(0, maxLength);
}

/** モデルが返す、まだ何も信用していない形 */
export interface RawExtraction {
  date?: unknown;
  name?: unknown;
  clinic?: unknown;
  nextDueDate?: unknown;
}

export interface NormalizedExtraction {
  date: DateStr | null;
  name: string | null;
  clinic: string | null;
  nextDueDate: DateStr | null;
  /** 次回予定日に「日」が無く、1日で補ったか */
  nextDueDateApproximate: boolean;
  /** 読み取れたが妥当でないので捨てた項目。UI で理由を出すのに使う */
  dropped: string[];
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** モデルが何かしら値を入れてきたか。null/undefined/空文字だけを「無回答」とみなす */
function wasProvided(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/**
 * 読み取り結果を DB に渡してよい形にする。
 *
 * today は呼び出し側から渡す（この関数を純粋に保ち、テストで日付を固定するため）。
 */
export function normalizeExtraction(
  raw: RawExtraction,
  today: DateStr,
): NormalizedExtraction {
  const dropped: string[] = [];

  let date: DateStr | null = null;
  const parsedDate = parseCertificateDate(raw.date);
  if (parsedDate !== null) {
    // 接種日は過去。未来なら次回予定日を読み違えている可能性が高い
    // 下限は isDateOnly() が保証する（2000年より前は通らない）
    if (parsedDate.date > today) {
      dropped.push("接種日");
    } else {
      date = parsedDate.date;
    }
  } else if (wasProvided(raw.date)) {
    dropped.push("接種日");
  }

  let nextDueDate: DateStr | null = null;
  let nextDueDateApproximate = false;
  const parsedNext = parseCertificateDate(raw.nextDueDate, { allowMonthOnly: true });
  if (parsedNext !== null) {
    const tooFar = yearOf(parsedNext.date) > yearOf(today) + MAX_FUTURE_YEARS;
    // saveVaccination は次回予定日 < 接種日 を弾く。ここで先に落としておく
    const beforeShot = date !== null && parsedNext.date < date;
    if (tooFar || beforeShot) {
      dropped.push("次回予定日");
    } else {
      nextDueDate = parsedNext.date;
      nextDueDateApproximate = parsedNext.approximate;
    }
  } else if (wasProvided(raw.nextDueDate)) {
    dropped.push("次回予定日");
  }

  // プレースホルダ（"不明" など）は「無回答」と同じ扱いにして dropped に入れない。
  // 読み取れなかったと騒ぐ価値がないため。
  const name = cleanText(raw.name, 100);
  if (name === null && wasProvided(raw.name) && !isPlaceholder(raw.name)) {
    dropped.push("ワクチン名");
  }
  const clinic = cleanText(raw.clinic, 100);
  if (clinic === null && wasProvided(raw.clinic) && !isPlaceholder(raw.clinic)) {
    dropped.push("動物病院");
  }

  return { date, name, clinic, nextDueDate, nextDueDateApproximate, dropped };
}
