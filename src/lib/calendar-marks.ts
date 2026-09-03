/**
 * カレンダーのマスに出す「印」を組み立てる、純粋なロジック。
 *
 * DB も React も import しない（calendar.ts / home.ts と同じ立ち位置で、
 * tsx --test で単体実行できる）。日付はすべて DATE ONLY の 'YYYY-MM-DD' で、
 * どの月を描くかは range として呼び出し側から渡す。
 *
 * **「今日」も呼び出し側から渡す。** トリミング・通院の記録は「予約した日」
 * なので未来の日付を持てるが、行った／まだの列は無い（schema.ts の
 * care_visits を参照）。予定か記録かは **date が今日より先か** だけで決まる
 * ので、この関数がそれを判定するには今日が要る。判定は1箇所（下の
 * careState）にしかなく、ホーム（home.ts の trimmingRow）も同じ「今日より
 * 先なら予約」で線を引く。
 *
 * **クエリを増やさない**: 日付を持つ記録はすでに care / log のクエリが引いて
 * いる。カレンダー用にもう1本引くと「その日に何があったか」の答えが2箇所に
 * でき、片方だけ直る日が来る。ここは既存の戻り値を受けて選んで並べるだけ。
 *
 * **ワクチンの予定日を自分で判定しない**: どれが生きている予定かは
 * home.ts の liveVaccinationDues が決めている。同じ判定をここに書くと、
 * ホームが「もう用済み」とみなした去年の予定日をカレンダーだけが出し続ける
 * ことになる（＝同じことを2箇所で決めている）。予定の印はあの関数の戻り
 * だけから作る。
 *
 * **「過ぎています」を言わない**: 飲ませていないフィラリアは、予定日に
 * 予定 の印が出るだけ。その日そう計画されていたことは事実で、遅れを言うのは
 * ホームの緊急バンド（buildHomeSchedule）の仕事。ここで色や文言を変えると
 * 同じ遅れを2画面が別々に判定することになる。
 */

import { CARE_KINDS, isDateOnly, type CareKind, type DateStr } from "./calendar";
import { liveVaccinationDues } from "./home";

export type MarkKind = "trimming" | "hospital" | "heartworm" | "vaccination";
/** 記録（もう起きた）か予定（これから／その日の予定だった）か */
export type MarkState = "done" | "planned";
export type MarkIcon = "scissors" | "stethoscope" | "pill" | "syringe";

export interface CalendarMark {
  /** React の key。同じ日に同種が複数あり得る */
  key: string;
  kind: MarkKind;
  state: MarkState;
  /** マスの aria-label とアジェンダの行頭。「トリミング」「通院の予定」など */
  label: string;
  icon: MarkIcon;
  /** 印の行き先 */
  href: string;
  /** アジェンダの補足（薬名・ワクチン名）。無ければ null */
  detail: string | null;
}

export interface MarkSources {
  /** getCareDates(range.start, range.endExclusive) の戻り */
  careDates: Map<DateStr, CareKind[]>;
  /** getVaccinationDates(ym) の戻り。接種した日 → ワクチン名 */
  vaccinationDates: Map<DateStr, string[]>;
  /** getHeartwormDoses() の戻り。**月で絞るのはこの関数の仕事** */
  doses: readonly {
    id: number; scheduledDate: DateStr; givenDate: DateStr | null; label: string | null;
  }[];
  /** getVaccinationSchedule() の戻り。live 判定は liveVaccinationDues に任せる */
  vaccinationSchedule: readonly {
    id: number; date: DateStr; name: string; nextDueDate: DateStr | null;
  }[];
  /** monthRange(ym) の戻り。この範囲の外は捨てる */
  range: { start: DateStr; endExclusive: DateStr };
  /** todayJst() の戻り。トリミング・通院の date がこれより先なら「予定」 */
  today: DateStr;
}

interface MarkSpec {
  kind: MarkKind;
  state: MarkState;
  label: string;
  icon: MarkIcon;
  href: string;
}

type SpecKey = `${MarkKind}:${MarkState}`;

/**
 * 印の見え方と行き先。ラベルは**種類だけ**で薬名やワクチン名を含めない
 * （マスの幅は日にちぶんしか無いので、名前は detail に回す）。
 */
const MARK_SPEC: Record<SpecKey, MarkSpec> = {
  "trimming:done": {
    kind: "trimming",
    state: "done",
    label: "トリミング",
    icon: "scissors",
    href: "/care",
  },
  "trimming:planned": {
    kind: "trimming",
    state: "planned",
    label: "トリミングの予定",
    icon: "scissors",
    href: "/care",
  },
  "hospital:done": {
    kind: "hospital",
    state: "done",
    label: "通院",
    icon: "stethoscope",
    href: "/care?tab=hospital",
  },
  "hospital:planned": {
    kind: "hospital",
    state: "planned",
    label: "通院の予定",
    icon: "stethoscope",
    href: "/care?tab=hospital",
  },
  "heartworm:done": {
    kind: "heartworm",
    state: "done",
    label: "フィラリア",
    icon: "pill",
    href: "/care?tab=heartworm",
  },
  "heartworm:planned": {
    kind: "heartworm",
    state: "planned",
    label: "フィラリアの予定",
    icon: "pill",
    href: "/care?tab=heartworm",
  },
  "vaccination:done": {
    kind: "vaccination",
    state: "done",
    label: "ワクチン",
    icon: "syringe",
    href: "/calendar?tab=vaccination",
  },
  "vaccination:planned": {
    kind: "vaccination",
    state: "planned",
    label: "ワクチンの予定",
    icon: "syringe",
    href: "/calendar?tab=vaccination",
  },
};

/** 記録が先、予定が後（起きたことのほうが確かなので上に置く） */
const STATE_RANK: Record<MarkState, number> = { done: 0, planned: 1 };
const KIND_RANK: Record<MarkKind, number> = {
  trimming: 0,
  hospital: 1,
  heartworm: 2,
  vaccination: 3,
};

/** 空文字は「無い」と同じ扱い。アジェンダに空の補足行を出さないため */
const detailOf = (raw: string | null | undefined): string | null => {
  const t = raw?.trim();
  return t ? t : null;
};

/**
 * トリミング・通院の記録が予定か記録か。**今日より先だけが予定**。
 * 今日の予約は「今日のトリミング」で、行ったかどうかを知る列が無い以上
 * その日のうちに印を付け替えることはできない。今日を記録側に置くのは、
 * 過ぎた予約を行ったものとみなす規則（schema.ts）と同じ線を引くため。
 */
export const careState = (date: DateStr, today: DateStr): MarkState =>
  date > today ? "planned" : "done";

/**
 * 1日あたりの印を組み立てる。**順序は固定**（マスの中で印が入れ替わらないため）:
 * 記録が先、予定が後。それぞれの中では trimming → hospital → heartworm → vaccination。
 */
export function buildCalendarMarks(src: MarkSources): Map<DateStr, CalendarMark[]> {
  const byDate = new Map<DateStr, CalendarMark[]>();
  const { start, endExclusive } = src.range;

  /**
   * 月で絞ってあるソース（getVaccinationDates）と、全件返すソース
   * （getHeartwormDoses / getVaccinationSchedule）が混ざっているので、
   * どれも同じ関門を通す。前後の月のマスに先月ぶんの印が漏れない。
   */
  const inRange = (date: DateStr | null): date is DateStr =>
    date !== null && isDateOnly(date) && date >= start && date < endExclusive;

  const push = (date: DateStr, spec: MarkSpec, key: string, detail: string | null) => {
    const mark: CalendarMark = {
      key,
      kind: spec.kind,
      state: spec.state,
      label: spec.label,
      icon: spec.icon,
      href: spec.href,
      detail,
    };
    const list = byDate.get(date);
    if (list) list.push(mark);
    else byDate.set(date, [mark]);
  };

  // トリミング・通院。CARE_KINDS の順に見るので、Map に入っていた kind の
  // 並び（SQL の行順）で印が入れ替わることがない。1日1種類1個で足りる
  // （同じ日に2回トリミングしても、飼い主が見たいのは「その日」）。
  // 今日より先の日付は予約なので「予定」の印（破線）になる
  for (const [date, kinds] of src.careDates) {
    if (!inRange(date)) continue;
    const state = careState(date, src.today);
    for (const kind of CARE_KINDS) {
      if (!kinds.includes(kind)) continue;
      push(date, MARK_SPEC[`${kind}:${state}`], `${kind}-${state}`, null);
    }
  }

  // 接種の記録。名前で並べるのは、同じ日に2本打った日の印の順を
  // SQL の行順（不定）に任せないため
  for (const [date, names] of src.vaccinationDates) {
    if (!inRange(date)) continue;
    const sorted = [...names].sort();
    sorted.forEach((name, i) => {
      push(date, MARK_SPEC["vaccination:done"], `vaccination-done-${i}`, detailOf(name));
    });
  }

  /**
   * フィラリア。飲ませた日が入っていれば**その日**の記録、空なら予定日の予定。
   * 予定と違う日に飲ませたら印はその日へ動く（カレンダーは計画ではなく
   * その日に起きたことを描く）。id 昇順で並べるのは、同じ日に2件あるときの
   * 順を戻り値の並びに依存させないため。
   */
  for (const d of [...src.doses].sort((a, b) => a.id - b.id)) {
    const detail = detailOf(d.label);
    if (d.givenDate !== null) {
      // 1回の投薬は印1つ。記録になった予定日には何も残さない
      if (inRange(d.givenDate)) {
        push(d.givenDate, MARK_SPEC["heartworm:done"], `heartworm-done-${d.id}`, detail);
      }
      continue;
    }
    if (inRange(d.scheduledDate)) {
      push(
        d.scheduledDate,
        MARK_SPEC["heartworm:planned"],
        `heartworm-planned-${d.id}`,
        detail,
      );
    }
  }

  // ワクチンの予定。生きている予定日の判定は liveVaccinationDues に任せる
  // （ホームと同じ答えでなければ、2画面が別の予定を語ることになる）
  for (const due of liveVaccinationDues(src.vaccinationSchedule)) {
    if (!inRange(due.dueDate)) continue;
    push(
      due.dueDate,
      MARK_SPEC["vaccination:planned"],
      `vaccination-planned-${due.id}`,
      detailOf(due.name),
    );
  }

  // 種類ごとの生成順（id 昇順・名前順）は Array#sort が安定なので残る。
  // 入力の Map の並びに順序が左右されないのはここまでで保証済み
  for (const marks of byDate.values()) {
    marks.sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] || KIND_RANK[a.kind] - KIND_RANK[b.kind],
    );
  }

  return byDate;
}
