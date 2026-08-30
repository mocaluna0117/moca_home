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

/**
 * 住所・電話・氏名らしき文字列。証明書には写るが DB には入れない。
 *
 * 証明書は「病院名」と「院長名・飼い主名」が紙面上で隣接して印刷される。
 * 悪意がなくても clinic に「さくら動物病院 院長 田中太郎」と入る事故が普通に
 * 起きるので、敬称や肩書きを含む値はまるごと捨てる。
 * 一部を削って残すことはしない（削り残しのほうが危ない）。
 */
const PII_PATTERNS: readonly RegExp[] = [
  // 郵便番号・メール・国番号
  /〒/,
  /@/,
  /\+81/,
  // 電話。日本の表記ゆれが広いので、ラベル・括弧書き・連続数字を全部見る
  /TEL|Tel|tel|℡|電話|FAX|Fax|fax/,
  /\d{2,4}\s*[(（]\s*\d{2,4}\s*[)）]\s*\d{3,4}/,
  /\d{10,11}/,
  // 住所。「東京都世田谷区」「神奈川県横浜市」のような都道府県＋市区町村と、
  // 「4丁目1番8号」「2-1-5」のような番地表記
  /[都道府県].{0,15}[市区町村郡]/,
  /[市区町村郡][^\s]{0,10}\d/,
  /\d+\s*丁目|\d+\s*番地|\d+\s*番\s*\d+\s*号/,
  /\d+-\d+-\d+/,
  // 氏名が併記される形
  /院長|副院長|獣医師|担当医|飼い主|所有者/,
  /[様殿]/,
  /先生/,
];

/**
 * 全角数字と記号を半角へ。手書きOCRは全角を返しがち。
 *
 * ダッシュ類は **数字に挟まれているときだけ** 半角ハイフンにする。
 * 一律に変換すると U+30FC（長音）まで巻き込み、「ブースター」が
 * 「ブ-スタ-」になる。ワクチン名はカタカナが主体なので実害が大きい。
 */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[／]/g, "/")
    .replace(/[．]/g, ".")
    .replace(/(\d)[－−ー―‐](?=\d)/g, "$1-")
    .replace(/　/g, " ");
}

interface Ymd {
  year: number;
  month: number;
  /** 「令和9年5月」のように日が無い証明書があるため null を許す */
  day: number | null;
}

/** 文字列中に日付らしき並びがいくつあるか。2つ以上なら曖昧とみなす */
function countDateCandidates(s: string): number {
  const found = new Set<string>();
  const wareki = /(?:令和|令|平成|平|[RrHh])\s*(?:元|\d{1,2})\s*(?:年|[./-])\s*\d{1,2}/g;
  const seireki = /\d{4}\s*(?:年|[./-])\s*\d{1,2}/g;
  for (const re of [wareki, seireki]) {
    for (const m of s.matchAll(re)) found.add(m[0].replace(/\s+/g, ""));
  }
  return found.size;
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

  // 「接種日 2025/5/3 次回 2026/5/3」のように候補が2つ以上あるときは、
  // どちらを指しているか決められないので採らない。黙って先頭を選ぶと
  // 次回予定日を接種日として保存してしまう。
  if (countDateCandidates(s) > 1) return null;

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
  // 上限を超える値は切り詰めずに捨てる。頭100文字だけの誤った病院名が
  // 入るより、空欄にして人に打たせるほうが安全。
  if (text.length > maxLength) return null;
  return text;
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
    // saveVaccination は次回予定日 < 接種日 を弾く。ここではさらに厳しく、
    // 同日も落とす（正規化が保存より厳しいぶんには問題ない）
    // 同日は証明書に存在しない組み合わせ。モデルが同じ行を2度読んだ徴候
    const beforeShot = date !== null && parsedNext.date <= date;
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
