/**
 * ホームの【0】緊急バンドと【2】次の予定を決める、純粋なロジック。
 *
 * DB も React も import しない（calendar.ts / heartworm.ts と同じ立ち位置で、
 * tsx --test で単体実行できる）。日付はすべて DATE ONLY の 'YYYY-MM-DD' で、
 * 「今日」は呼び出し側から渡す。
 *
 * **判定をコンポーネントに置かない理由**: バンドと行が同じ「過ぎている」を
 * 別々に判定すると、同じことを二度言う日が来る（設計審査でその欠陥が実際に
 * 出た）。buildHomeSchedule が urgent と rows を**同時に**返し、バンドに出した
 * 種類の行は過去を語らないところまでを1つの関数の責任にする。
 * urgent-band.tsx / next-up-section.tsx は分岐を持たず、描くだけ。
 */

import { addDays, diffDays, isDateOnly, type DateStr } from "./calendar";
import { doseStatus } from "./heartworm";

export type ScheduleKind = "heartworm" | "vaccination" | "trimming";

/** 緊急バンドに出る種類。トリミングは予定日を持てないので入らない */
export type UrgentKind = Extract<ScheduleKind, "heartworm" | "vaccination">;

const SCHEDULE_LABEL: Record<ScheduleKind, string> = {
  heartworm: "フィラリア",
  vaccination: "ワクチン",
  trimming: "トリミング",
};

const SCHEDULE_HREF: Record<ScheduleKind, string> = {
  heartworm: "/care?tab=heartworm",
  vaccination: "/calendar?tab=vaccination",
  trimming: "/care",
};

/**
 * 記録も予定も無い種類の1行。「◯◯が未登録です」を毎日2行のピッチで
 * 言い続けないよう、種類名を含んだ1文にして muted の1行に畳む。
 */
const UNSET_TEXT: Record<ScheduleKind, string> = {
  heartworm: "フィラリア ・ 予定なし",
  vaccination: "ワクチン ・ 次回予定日が未登録",
  trimming: "トリミング ・ 記録なし",
};

/**
 * バンドに積む上限。これを超えるとヒーロー（「今日のもか」）が
 * 1画面目から押し出される。
 */
export const MAX_URGENT = 3;

/**
 * トリミングの間隔として信用する下限・上限（日）。実際の周期は4〜8週なので、
 * これを外れた間隔は「周期」ではなく「たまたま空いた」ぶん。
 * もかの本当の周期が分かったら、直すのはこの2値だけ。
 */
export const TRIM_MIN_INTERVAL = 21;
export const TRIM_MAX_INTERVAL = 120;
/** 中央値を取るのに要求する間隔の本数。間隔3本 = 日付4件 */
export const TRIM_REQUIRED_INTERVALS = 3;

// --------------------------------------------------------------- 入力の形
//
// server-only なクエリ層を import しないので、必要な列だけを構造的に受ける。
// queries-care.ts の HeartwormRow / queries-log.ts の VaccinationScheduleRow は
// そのまま代入できる（余分な列があっても構わない）。

/**
 * フィラリア予定の読み取り形。
 *
 * 列は **HeartwormRecordDialog の dose プロパティと同じ**にしてある。
 * UrgentItem.dose をバンドからそのまま渡せるようにするためで、
 * ここを削ると「バンド用の dose」をもう1つ組み立てる仕事が増える。
 */
export interface HeartwormDoseRow {
  id: number;
  scheduledDate: DateStr;
  /** 実際に飲ませた日。null なら未実施 */
  givenDate: DateStr | null;
  medicineId: number | null;
  /** 薬の名前（登録側を優先して解決済みのもの） */
  label: string | null;
  note: string | null;
}

/** ワクチン記録の読み取り形（接種日・名前・次回予定日だけ） */
export interface VaccinationRecord {
  id: number;
  date: DateStr;
  name: string;
  nextDueDate: DateStr | null;
}

// --------------------------------------------------------------- 出力の形

export interface UrgentItem {
  /** React の key。同じ種類が2行出ることがあるので kind だけでは足りない */
  key: string;
  kind: UrgentKind;
  /**
   * 予定日を過ぎている。当日は「失敗」ではないので false
   * （バンド側は false のとき destructive を使わない）。
   */
  overdue: boolean;
  /** 見出し1行。font-sans font-semibold で描く（font-cute は太くできない） */
  title: string;
  /** 補足1行。空文字にはならない */
  detail: string;
  /**
   * フィラリアのときだけ非 null。HeartwormRecordDialog の dose に
   * そのまま渡す（トリガー文言は既存の「飲ませた」で固定）。
   */
  dose: HeartwormDoseRow | null;
}

export type ScheduleState = "due" | "estimate" | "observed" | "unset";

/**
 * 「次の予定」の1行。常に3行・順序固定（フィラリア → ワクチン → トリミング）。
 *
 * 描画の対応（コンポーネントはこれ以上の判断をしない）:
 *   1行目 = アイコン + label（state==="estimate" のときだけ「目安」バッジ）
 *   2行目 = date があれば formatDayLabel(date) + relative、
 *           date が無く fallback があれば fallback だけ
 *   3行目 = detail
 *   state==="unset" は fallback の1行だけに畳む
 */
export interface ScheduleRow {
  kind: ScheduleKind;
  /** 「フィラリア」「ワクチン」「トリミング」 */
  label: string;
  state: ScheduleState;
  href: string;
  /** 2行目に出す暦日。日付を語れない行（observed / そろそろ / unset）は null */
  date: DateStr | null;
  /** 日付の右に添える相対表記。date が null なら null */
  relative: string | null;
  /** 日付の代わりに出す1文（unset の1行 / 「そろそろの時期です」） */
  fallback: string | null;
  /** 3行目（薬名 / ワクチン名 / 目安の根拠 / 「前回 …」） */
  detail: string | null;
}

export interface HomeScheduleInput {
  /** getHeartwormDoses() の戻り。並び順には依存しない */
  doses: readonly HeartwormDoseRow[];
  /** getVaccinationSchedule() の戻り */
  vaccineSchedule: readonly VaccinationRecord[];
  /** getRecentCareDates("trimming", 4) の戻り */
  trimmingDates: readonly DateStr[];
}

export interface HomeSchedule {
  /** 空配列ならバンドを描かない（平常日は DOM に無い） */
  urgent: UrgentItem[];
  /** 常に3件 */
  rows: ScheduleRow[];
}

// ------------------------------------------------------------------ 表示部品

/** 「8月28日」。バンドの補足では曜日まで言わない（1行に収めたい） */
const monthDay = (date: DateStr): string =>
  `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;

/** 空の部分は落として ・ で繋ぐ。薬名が未登録でも「 ・ 」が浮かない */
const joinDetail = (...parts: (string | null)[]): string =>
  parts.filter((p): p is string => p !== null && p !== "").join(" ・ ");

const lastOf = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

/** 「今日」「きのう」「50日前」。「0日前」「-3日前」を出さないため */
const agoLabel = (date: DateStr, today: DateStr): string => {
  const n = diffDays(date, today);
  if (n <= 0) return "今日";
  return n === 1 ? "きのう" : `${n}日前`;
};

/**
 * 予定日と今日の距離を1語で。
 *
 * 「1日後」ではなく「あすです」、「-1日」ではなく「きのう」と言う。
 * 過ぎている日は日数を明示するが、バンドが使うもっと強い「おくれています」
 * とは言い分けて重複を避ける。
 */
export function relativeDayLabel(date: DateStr, today: DateStr): string {
  const d = diffDays(today, date);
  if (d === 0) return "今日";
  if (d === 1) return "あすです";
  if (d === -1) return "きのう";
  return d > 0 ? `あと${d}日` : `${-d}日すぎています`;
}

// ---------------------------------------------------------------- ワクチン

export interface VaccinationDue {
  /** ワクチン名。**完全一致**でまとめた系統名 */
  name: string;
  /** その系統の最新記録が書いた次回予定日 */
  dueDate: DateStr;
  /** その予定を書いた接種日 */
  recordedOn: DateStr;
  /** もとの記録の id */
  id: number;
}

/**
 * 「生きているワクチン予定日」。
 *
 * 名前が完全一致する記録を1系統とみなし、系統ごとに**最新の1件だけ**の
 * next_due_date を予定として扱う。古い記録の予定日は、同じ名前で次を接種した
 * 時点で用済みになる — そこを見ないと去年の予定日が永久に「過ぎています」と
 * 言い続ける。
 *
 * 名前の表記ゆれ（「6種混合」と「6種混合ワクチン」）は別系統になるので、
 * 置き去りになった系統が過ぎたままになることは避けられない。緩和は
 * buildHomeSchedule 側で「過ぎている系統はバンドに最大1件」に絞ること。
 * 正しい直し方は接種記録側に系統の概念を持つことで、それは今回の範囲外。
 */
export function liveVaccinationDues(
  rows: readonly VaccinationRecord[],
): VaccinationDue[] {
  const newest = new Map<string, VaccinationRecord>();
  for (const r of rows) {
    if (!isDateOnly(r.date)) continue;
    const prev = newest.get(r.name);
    // 同じ接種日が2件あるときは、あとから入れた（id が大きい）ほうを最新とする
    if (!prev || r.date > prev.date || (r.date === prev.date && r.id > prev.id)) {
      newest.set(r.name, r);
    }
  }

  const dues: VaccinationDue[] = [];
  for (const r of newest.values()) {
    if (r.nextDueDate === null || !isDateOnly(r.nextDueDate)) continue;
    dues.push({ name: r.name, dueDate: r.nextDueDate, recordedOn: r.date, id: r.id });
  }
  // 近い予定が先。同じ日なら新しく入れた記録を先に（並びを決めきる）
  return dues.sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : b.id - a.id,
  );
}

// -------------------------------------------------------------- トリミング

export interface TrimmingEstimate {
  /** 直近3間隔の中央値（日） */
  intervalDays: number;
  /** 前回トリミングした日 */
  lastDate: DateStr;
  /** 前回 + 中央値 */
  nextDate: DateStr;
}

/**
 * トリミングの次回の目安。**言えないときは何も言わない。**
 *
 * 日付4件（= 間隔3本）そろって、その3本すべてが TRIM_MIN_INTERVAL〜
 * TRIM_MAX_INTERVAL に収まっているときだけ、中央値で次回を出す。
 *
 * - 間隔1〜2本から推定するのは捏造。周期かどうかがまだ分からない
 * - 平均ではなく中央値。1回の長い空白（旅行・入院）が全部を引っ張らない
 * - 1本でも範囲外なら推定しない。中央値だけを見ると 200日・25日・30日 で
 *   「約30日ごと」と言ってしまい、200日の空白が消える
 */
export function estimateNextTrimming(
  dates: readonly DateStr[],
): TrimmingEstimate | null {
  const sorted = sortDatesDesc(dates);
  // 間隔3本には日付4件が必要
  if (sorted.length <= TRIM_REQUIRED_INTERVALS) return null;

  const intervals: number[] = [];
  for (let i = 0; i < TRIM_REQUIRED_INTERVALS; i++) {
    intervals.push(diffDays(sorted[i + 1], sorted[i]));
  }
  if (intervals.some((n) => n < TRIM_MIN_INTERVAL || n > TRIM_MAX_INTERVAL)) {
    return null;
  }

  const median = [...intervals].sort((a, b) => a - b)[
    Math.floor(TRIM_REQUIRED_INTERVALS / 2)
  ];
  return {
    intervalDays: median,
    lastDate: sorted[0],
    nextDate: addDays(sorted[0], median),
  };
}

/** 新しい順。同じ日が2件あると間隔0本を生むので重複も落とす */
const sortDatesDesc = (dates: readonly DateStr[]): DateStr[] =>
  [...new Set(dates.filter(isDateOnly))].sort().reverse();

// ------------------------------------------------------------------- 組立て

/**
 * 緊急バンドと「次の予定」を**同時に**作る。
 *
 * 分けて作れないのは、行の内容がバンドの結果に依存するため:
 * バンドに出した種類の行は「過ぎている」を二度言わず、次の未来日か
 * unset に落ちる。畳んで実際に描かれなかったぶん（MAX_URGENT 超過）は
 * 「言った」に数えないので、判定は最終的な urgent 配列から取る。
 */
export function buildHomeSchedule(
  input: HomeScheduleInput,
  today: DateStr,
): HomeSchedule {
  const pending = [...input.doses]
    .filter((d) => d.givenDate === null && isDateOnly(d.scheduledDate))
    .sort((a, b) =>
      a.scheduledDate < b.scheduledDate
        ? -1
        : a.scheduledDate > b.scheduledDate
          ? 1
          : a.id - b.id,
    );
  const dues = liveVaccinationDues(input.vaccineSchedule);

  const urgent = buildUrgent(pending, dues, today);
  const spoken = new Set<ScheduleKind>(urgent.map((u) => u.kind));

  return {
    urgent,
    rows: [
      heartwormRow(pending, today, spoken.has("heartworm")),
      vaccinationRow(dues, today, spoken.has("vaccination")),
      trimmingRow(input.trimmingDates, today),
    ],
  };
}

/**
 * 並びは「フィラリア過ぎ → フィラリア当日 → ワクチン過ぎ → ワクチン当日」。
 * 過ぎているほうが常に上（当日は失敗ではない）。
 */
function buildUrgent(
  pending: readonly HeartwormDoseRow[],
  dues: readonly VaccinationDue[],
  today: DateStr,
): UrgentItem[] {
  const items: UrgentItem[] = [];

  // pending は日付昇順なので先頭がいちばん古い
  const overdueDoses = pending.filter((d) => doseStatus(d, today) === "overdue");
  const oldest = overdueDoses[0];
  if (oldest) {
    const late = diffDays(oldest.scheduledDate, today);
    const many = overdueDoses.length > 1;
    items.push({
      key: `heartworm-overdue-${oldest.id}`,
      kind: "heartworm",
      overdue: true,
      // 複数を1行に畳む。1件ずつ並べるとバンドだけで画面が埋まる
      title: many
        ? `フィラリアの未投薬が${overdueDoses.length}件あります`
        : `フィラリアが${late}日おくれています`,
      detail: many
        ? `いちばん古いのは${monthDay(oldest.scheduledDate)}（${late}日おくれ）`
        : joinDetail(`${monthDay(oldest.scheduledDate)}の予定`, oldest.label),
      // 「飲ませた」は detail が指している行（いちばん古い予定）に付ける
      dose: oldest,
    });
  }

  const todayDose = pending.find((d) => doseStatus(d, today) === "today");
  if (todayDose) {
    items.push({
      key: `heartworm-today-${todayDose.id}`,
      kind: "heartworm",
      overdue: false,
      title: "きょうはフィラリアの日",
      // 薬が未登録でも空行にしない
      detail: todayDose.label ?? `${monthDay(todayDose.scheduledDate)}の予定`,
      dose: todayDose,
    });
  }

  /**
   * ワクチンは過ぎ・当日ともに**最大1件**。名前の表記ゆれで置き去りになった
   * 系統が増えるほど行が増えてしまうため。過ぎている系統が複数あるときは
   * 予定日が**いちばん新しい**ものを出す — 古いほうはたいてい表記ゆれで
   * 死んだ系統で、それを毎日出しても直せない（新しいほうは次を接種すれば消える）。
   */
  const overdueDue = lastOf(dues.filter((d) => d.dueDate < today));
  if (overdueDue) {
    items.push({
      key: `vaccination-overdue-${overdueDue.id}`,
      kind: "vaccination",
      overdue: true,
      title: "ワクチンの予定日をすぎています",
      detail: `${overdueDue.name} ・ ${monthDay(overdueDue.dueDate)}の予定`,
      dose: null,
    });
  }

  const todayDue = dues.find((d) => d.dueDate === today);
  if (todayDue) {
    items.push({
      key: `vaccination-today-${todayDue.id}`,
      kind: "vaccination",
      overdue: false,
      title: "きょうはワクチンの予定日",
      detail: todayDue.name,
      dose: null,
    });
  }

  return items.slice(0, MAX_URGENT);
}

const baseRow = (kind: ScheduleKind, state: ScheduleState): ScheduleRow => ({
  kind,
  label: SCHEDULE_LABEL[kind],
  state,
  href: SCHEDULE_HREF[kind],
  date: null,
  relative: null,
  fallback: null,
  detail: null,
});

const unsetRow = (kind: ScheduleKind): ScheduleRow => ({
  ...baseRow(kind, "unset"),
  fallback: UNSET_TEXT[kind],
});

function heartwormRow(
  pending: readonly HeartwormDoseRow[],
  today: DateStr,
  spokenInBand: boolean,
): ScheduleRow {
  // バンドに出ているなら、この行は**未来の予定だけ**を語る。
  // 当日ぶんもバンドが持っているので today は含めない（> today）。
  const next = spokenInBand
    ? pending.find((d) => d.scheduledDate > today)
    : pending[0];
  if (!next) return unsetRow("heartworm");
  return {
    ...baseRow("heartworm", "due"),
    date: next.scheduledDate,
    relative: relativeDayLabel(next.scheduledDate, today),
    detail: next.label,
  };
}

function vaccinationRow(
  dues: readonly VaccinationDue[],
  today: DateStr,
  spokenInBand: boolean,
): ScheduleRow {
  // dues は予定日の昇順。バンドに出ていなければ当日ぶんはこの行が持つ
  const next = dues.find((d) => (spokenInBand ? d.dueDate > today : d.dueDate >= today));
  if (!next) return unsetRow("vaccination");
  return {
    ...baseRow("vaccination", "due"),
    date: next.dueDate,
    relative: relativeDayLabel(next.dueDate, today),
    detail: next.name,
  };
}

function trimmingRow(
  trimmingDates: readonly DateStr[],
  today: DateStr,
): ScheduleRow {
  const dates = sortDatesDesc(trimmingDates);
  if (dates.length === 0) return unsetRow("trimming");

  const est = estimateNextTrimming(dates);
  if (est) {
    const basis = `前回 ${monthDay(est.lastDate)}から約${est.intervalDays}日ごと`;
    // 目安が過ぎている日は日付を出さない。観測から出した数字に
    // 「おくれている」と言わせるのは、目安に予定のふりをさせること
    if (est.nextDate < today) {
      return {
        ...baseRow("trimming", "estimate"),
        fallback: "そろそろの時期です",
        detail: basis,
      };
    }
    return {
      ...baseRow("trimming", "estimate"),
      date: est.nextDate,
      relative: relativeDayLabel(est.nextDate, today),
      detail: basis,
    };
  }

  // 間隔が3本そろわない / 範囲外 = 観測だけを言う（推定を捏造しない）
  return {
    ...baseRow("trimming", "observed"),
    detail: `前回 ${monthDay(dates[0])}（${agoLabel(dates[0], today)}）`,
  };
}
