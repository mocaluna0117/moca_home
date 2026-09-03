import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monthRange, type CareKind, type DateStr } from "./calendar";
import {
  buildCalendarMarks,
  type CalendarMark,
  type MarkSources,
} from "./calendar-marks";

/** 描く月は 2026年8月に固定（monthRange の戻りをそのまま使う） */
const RANGE = monthRange("2026-08")!;
/** 「今日」。トリミング・通院の date がこれより先なら予定 */
const TODAY = "2026-08-20";

let seq = 0;

type DoseRow = MarkSources["doses"][number];
type VacRow = MarkSources["vaccinationSchedule"][number];

const dose = (scheduledDate: DateStr, extra: Partial<DoseRow> = {}): DoseRow => ({
  id: ++seq,
  scheduledDate,
  givenDate: null,
  label: null,
  ...extra,
});

const vac = (date: DateStr, name: string, nextDueDate: DateStr | null): VacRow => ({
  id: ++seq,
  date,
  name,
  nextDueDate,
});

const careMap = (entries: [DateStr, CareKind[]][]) => new Map(entries);
const vacMap = (entries: [DateStr, string[]][]) => new Map(entries);

const build = (src: Partial<MarkSources> = {}) =>
  buildCalendarMarks({
    careDates: new Map(),
    vaccinationDates: new Map(),
    doses: [],
    vaccinationSchedule: [],
    range: RANGE,
    today: TODAY,
    ...src,
  });

const on = (map: Map<DateStr, CalendarMark[]>, date: DateStr): CalendarMark[] =>
  map.get(date) ?? [];

/** 並びの比較用。「種類:記録か予定か」だけを見る */
const shapes = (marks: CalendarMark[]): string[] =>
  marks.map((m) => `${m.kind}:${m.state}`);

describe("buildCalendarMarks — 記録の印", () => {
  it("トリミング・通院・ワクチン・フィラリアの記録が印になる", () => {
    const marks = build({
      careDates: careMap([
        ["2026-08-05", ["trimming"]],
        ["2026-08-06", ["hospital"]],
      ]),
      vaccinationDates: vacMap([["2026-08-07", ["6種混合"]]]),
      doses: [dose("2026-08-10", { givenDate: "2026-08-10", label: "ネクスガード" })],
    });

    const trimming = on(marks, "2026-08-05")[0];
    assert.equal(trimming.kind, "trimming");
    assert.equal(trimming.state, "done");
    assert.equal(trimming.label, "トリミング");
    assert.equal(trimming.icon, "scissors");
    assert.equal(trimming.href, "/care");
    assert.equal(trimming.detail, null);

    const hospital = on(marks, "2026-08-06")[0];
    assert.equal(hospital.label, "通院");
    assert.equal(hospital.icon, "stethoscope");
    assert.equal(hospital.href, "/care?tab=hospital");

    const vaccination = on(marks, "2026-08-07")[0];
    assert.equal(vaccination.kind, "vaccination");
    assert.equal(vaccination.state, "done");
    assert.equal(vaccination.label, "ワクチン");
    assert.equal(vaccination.icon, "syringe");
    assert.equal(vaccination.href, "/calendar?tab=vaccination");
    // 名前はラベルではなく補足に入る（マスを広げないため）
    assert.equal(vaccination.detail, "6種混合");

    const heartworm = on(marks, "2026-08-10")[0];
    assert.equal(heartworm.kind, "heartworm");
    assert.equal(heartworm.state, "done");
    assert.equal(heartworm.label, "フィラリア");
    assert.equal(heartworm.icon, "pill");
    assert.equal(heartworm.href, "/care?tab=heartworm");
    assert.equal(heartworm.detail, "ネクスガード");
  });

  it("薬名が未登録なら detail は null", () => {
    const marks = build({
      doses: [dose("2026-08-10", { givenDate: "2026-08-10" })],
    });
    assert.equal(on(marks, "2026-08-10")[0].detail, null);
  });
});

describe("buildCalendarMarks — 予定の印", () => {
  it("未実施のフィラリアは予定日に「予定」として出る", () => {
    const marks = build({
      doses: [dose("2026-08-20", { label: "ネクスガード" })],
    });
    const mark = on(marks, "2026-08-20")[0];
    assert.equal(mark.kind, "heartworm");
    assert.equal(mark.state, "planned");
    assert.equal(mark.label, "フィラリアの予定");
    assert.equal(mark.icon, "pill");
    assert.equal(mark.href, "/care?tab=heartworm");
    assert.equal(mark.detail, "ネクスガード");
  });

  it("過ぎた予定も「予定」のまま（おくれの判定はホームの仕事）", () => {
    const marks = build({ doses: [dose("2026-08-01")] });
    assert.deepEqual(shapes(on(marks, "2026-08-01")), ["heartworm:planned"]);
  });

  it("ワクチンの次回予定日がその月に来ると予定の印になる", () => {
    const marks = build({
      vaccinationSchedule: [vac("2025-08-15", "6種混合", "2026-08-15")],
    });
    const mark = on(marks, "2026-08-15")[0];
    assert.equal(mark.kind, "vaccination");
    assert.equal(mark.state, "planned");
    assert.equal(mark.label, "ワクチンの予定");
    assert.equal(mark.icon, "syringe");
    assert.equal(mark.href, "/calendar?tab=vaccination");
    assert.equal(mark.detail, "6種混合");
  });

  it("次回予定日が未登録なら予定の印は出ない", () => {
    const marks = build({
      vaccinationSchedule: [vac("2026-08-15", "6種混合", null)],
    });
    assert.equal(marks.size, 0);
  });
});

describe("buildCalendarMarks — トリミング・通院の予約（今日より先の date）", () => {
  it("今日より先の日付は「〜の予定」の印になる（破線側）", () => {
    const marks = build({
      careDates: careMap([
        ["2026-08-25", ["trimming"]],
        ["2026-08-26", ["hospital"]],
      ]),
    });
    const trimming = on(marks, "2026-08-25")[0];
    assert.equal(trimming.kind, "trimming");
    assert.equal(trimming.state, "planned");
    assert.equal(trimming.label, "トリミングの予定");
    assert.equal(trimming.icon, "scissors");
    assert.equal(trimming.href, "/care");
    assert.equal(trimming.detail, null);

    const hospital = on(marks, "2026-08-26")[0];
    assert.equal(hospital.state, "planned");
    assert.equal(hospital.label, "通院の予定");
    assert.equal(hospital.href, "/care?tab=hospital");
  });

  it("今日の予約は記録の印（その日のうちに付け替える列が無い）", () => {
    const marks = build({ careDates: careMap([[TODAY, ["trimming"]]]) });
    assert.deepEqual(shapes(on(marks, TODAY)), ["trimming:done"]);
    assert.equal(on(marks, TODAY)[0].label, "トリミング");
  });

  it("過ぎた予約は行ったものとみなす（「過ぎています」は言わない）", () => {
    const marks = build({ careDates: careMap([["2026-08-19", ["trimming"]]]) });
    assert.deepEqual(shapes(on(marks, "2026-08-19")), ["trimming:done"]);
  });

  it("同じ日の記録と予定で key が重ならない", () => {
    const marks = build({
      careDates: careMap([
        ["2026-08-25", ["trimming", "hospital"]],
        ["2026-08-05", ["trimming", "hospital"]],
      ]),
    });
    for (const date of ["2026-08-25", "2026-08-05"]) {
      const day = on(marks, date);
      assert.equal(new Set(day.map((m) => m.key)).size, day.length);
    }
    assert.deepEqual(shapes(on(marks, "2026-08-25")), [
      "trimming:planned",
      "hospital:planned",
    ]);
  });
});

describe("buildCalendarMarks — 飲ませた日は予定日と別でよい", () => {
  it("予定と違う日に飲ませたら印はその日へ動く", () => {
    const marks = build({
      doses: [dose("2026-08-10", { givenDate: "2026-08-12", label: "ネクスガード" })],
    });
    // 予定日には何も残さない（1回の投薬は印1つ）
    assert.deepEqual(on(marks, "2026-08-10"), []);
    assert.deepEqual(shapes(on(marks, "2026-08-12")), ["heartworm:done"]);
  });

  it("翌月に飲ませた予定は、その月のどこにも出ない", () => {
    const marks = build({
      doses: [dose("2026-08-28", { givenDate: "2026-09-02" })],
    });
    assert.equal(marks.size, 0);
  });
});

describe("buildCalendarMarks — 範囲の外は捨てる", () => {
  it("翌月初（endExclusive）と前月の日は入らない", () => {
    const marks = build({
      // getCareDates は月をまたいだ日を含めて返しうるので、ここで必ず落とす
      careDates: careMap([
        ["2026-07-31", ["trimming"]],
        ["2026-09-01", ["hospital"]],
        ["2026-08-31", ["hospital"]],
      ]),
      vaccinationDates: vacMap([["2026-09-01", ["6種混合"]]]),
      doses: [dose("2026-07-20"), dose("2026-09-05")],
      vaccinationSchedule: [vac("2025-09-01", "狂犬病", "2026-09-01")],
    });
    assert.deepEqual([...marks.keys()], ["2026-08-31"]);
  });

  it("暦日として存在しない日付は無視する", () => {
    const marks = build({
      careDates: careMap([["2026-08-32", ["trimming"]]]),
      doses: [dose("2026-02-30")],
    });
    assert.equal(marks.size, 0);
  });
});

describe("buildCalendarMarks — 同じ日に複数", () => {
  it("同じ日のトリミングと通院は、入力の並びに関わらず トリミング → 通院", () => {
    const marks = build({
      // 入力を逆順で渡す（SQL の行順は決まっていない）
      careDates: careMap([["2026-08-08", ["hospital", "trimming"]]]),
    });
    assert.deepEqual(shapes(on(marks, "2026-08-08")), [
      "trimming:done",
      "hospital:done",
    ]);
  });

  it("同じ日に予定が2件あっても key は重複しない", () => {
    const marks = build({
      doses: [
        dose("2026-08-20", { label: "ネクスガード" }),
        dose("2026-08-20", { label: "カルドメック" }),
      ],
    });
    const day = on(marks, "2026-08-20");
    assert.equal(day.length, 2);
    assert.equal(new Set(day.map((m) => m.key)).size, 2);
    // id 昇順 = 渡した順。入力の並び替えで印が入れ替わらない
    assert.deepEqual(
      day.map((m) => m.detail),
      ["ネクスガード", "カルドメック"],
    );
  });

  it("同じ日に2本接種した記録は、名前順に2つの印になる", () => {
    const marks = build({
      vaccinationDates: vacMap([["2026-08-07", ["狂犬病", "6種混合"]]]),
    });
    const day = on(marks, "2026-08-07");
    assert.equal(new Set(day.map((m) => m.key)).size, 2);
    assert.deepEqual(
      day.map((m) => m.detail),
      ["6種混合", "狂犬病"],
    );
  });
});

describe("buildCalendarMarks — 用済みのワクチン予定日", () => {
  it("同名で新しい記録があると、古い記録の予定日は印にならない", () => {
    const marks = build({
      vaccinationSchedule: [
        // 去年の記録が書いた「2026-08-20」は、7月に同じ名前を接種した時点で用済み
        vac("2025-08-20", "6種混合", "2026-08-20"),
        vac("2026-07-01", "6種混合", "2027-07-01"),
      ],
    });
    assert.equal(marks.size, 0);
  });

  it("名前が違う系統の予定日は生き残る", () => {
    const marks = build({
      vaccinationSchedule: [
        vac("2025-08-20", "6種混合", "2026-08-20"),
        vac("2026-07-01", "狂犬病", "2027-07-01"),
      ],
    });
    assert.deepEqual(shapes(on(marks, "2026-08-20")), ["vaccination:planned"]);
    assert.equal(on(marks, "2026-08-20")[0].detail, "6種混合");
  });
});

describe("buildCalendarMarks — 並び", () => {
  it("記録が先、予定が後。その中では トリミング → 通院 → フィラリア → ワクチン", () => {
    const marks = build({
      careDates: careMap([["2026-08-15", ["hospital", "trimming"]]]),
      vaccinationDates: vacMap([["2026-08-15", ["6種混合"]]]),
      doses: [
        dose("2026-08-15", { label: "予定のまま" }),
        dose("2026-08-15", { givenDate: "2026-08-15", label: "飲ませた" }),
      ],
      vaccinationSchedule: [vac("2025-08-15", "狂犬病", "2026-08-15")],
    });
    assert.deepEqual(shapes(on(marks, "2026-08-15")), [
      "trimming:done",
      "hospital:done",
      "heartworm:done",
      "vaccination:done",
      "heartworm:planned",
      "vaccination:planned",
    ]);
  });
});

describe("buildCalendarMarks — 何も無い月", () => {
  it("記録も予定も無ければ空の Map", () => {
    assert.equal(build().size, 0);
  });
});
