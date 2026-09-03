import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, type DateStr } from "./calendar";
import {
  MAX_URGENT,
  TRIM_MAX_INTERVAL,
  TRIM_MIN_INTERVAL,
  buildHomeSchedule,
  estimateNextTrimming,
  liveVaccinationDues,
  relativeDayLabel,
  type HeartwormDoseRow,
  type ScheduleKind,
  type ScheduleRow,
  type VaccinationRecord,
} from "./home";

/** 全テスト共通の「今日」。2026-08-31（月） */
const TODAY = "2026-08-31";

let seq = 0;

const dose = (
  scheduledDate: DateStr,
  extra: Partial<HeartwormDoseRow> = {},
): HeartwormDoseRow => ({
  id: ++seq,
  scheduledDate,
  givenDate: null,
  medicineId: null,
  label: null,
  note: null,
  ...extra,
});

const vac = (
  date: DateStr,
  name: string,
  nextDueDate: DateStr | null,
): VaccinationRecord => ({ id: ++seq, date, name, nextDueDate });

const build = (
  input: Partial<Parameters<typeof buildHomeSchedule>[0]>,
  today: DateStr = TODAY,
) =>
  buildHomeSchedule(
    { doses: [], vaccineSchedule: [], trimmingDates: [], trimmingReservations: [], ...input },
    today,
  );

const rowOf = (rows: ScheduleRow[], kind: ScheduleKind): ScheduleRow => {
  const row = rows.find((r) => r.kind === kind);
  assert.ok(row, `${kind} の行が無い`);
  return row;
};

describe("relativeDayLabel — 今日 / あす / きのう の境界", () => {
  it("当日・翌日・前日は日数で言わない", () => {
    assert.equal(relativeDayLabel(TODAY, TODAY), "今日");
    assert.equal(relativeDayLabel("2026-09-01", TODAY), "あすです");
    assert.equal(relativeDayLabel("2026-08-30", TODAY), "きのう");
  });
  it("2日以上先は「あとN日」", () => {
    assert.equal(relativeDayLabel("2026-09-02", TODAY), "あと2日");
    assert.equal(relativeDayLabel("2026-09-15", TODAY), "あと15日");
  });
  it("2日以上前は「N日すぎています」", () => {
    assert.equal(relativeDayLabel("2026-08-28", TODAY), "3日すぎています");
    assert.equal(relativeDayLabel("2026-07-28", TODAY), "34日すぎています");
  });
  it("月跨ぎ・年跨ぎでもずれない", () => {
    assert.equal(relativeDayLabel("2027-01-01", "2026-12-31"), "あすです");
    assert.equal(relativeDayLabel("2026-12-31", "2027-01-01"), "きのう");
  });
});

describe("liveVaccinationDues — 系統ごとの最新1件だけを予定とみなす", () => {
  it("同名グループの最新記録の next_due_date だけが生きている", () => {
    const dues = liveVaccinationDues([
      vac("2025-05-03", "6種混合ワクチン", "2026-05-03"),
      vac("2026-05-03", "6種混合ワクチン", "2027-05-03"),
    ]);
    assert.deepEqual(
      dues.map((d) => d.dueDate),
      ["2027-05-03"],
    );
    assert.equal(dues[0].recordedOn, "2026-05-03");
  });

  it("next_due_date が null の記録は予定にならない", () => {
    assert.deepEqual(liveVaccinationDues([vac("2026-04-01", "狂犬病予防注射", null)]), []);
  });

  it("最新記録の予定日が null なら、その系統は予定を持たない（古い予定を蘇らせない）", () => {
    const dues = liveVaccinationDues([
      vac("2025-05-03", "6種混合ワクチン", "2026-05-03"),
      vac("2026-05-03", "6種混合ワクチン", null),
    ]);
    assert.deepEqual(dues, []);
  });

  it("名前が違えば別系統。予定日の近い順に並ぶ", () => {
    const dues = liveVaccinationDues([
      vac("2026-04-01", "狂犬病予防注射", "2027-04-01"),
      vac("2026-05-03", "6種混合ワクチン", "2027-01-10"),
    ]);
    assert.deepEqual(
      dues.map((d) => [d.name, d.dueDate]),
      [
        ["6種混合ワクチン", "2027-01-10"],
        ["狂犬病予防注射", "2027-04-01"],
      ],
    );
  });

  it("表記ゆれは別系統になる（既知の限界。緩和はバンドの最大1件）", () => {
    const dues = liveVaccinationDues([
      vac("2025-05-03", "6種混合", "2026-05-03"),
      vac("2026-05-03", "6種混合ワクチン", "2027-05-03"),
    ]);
    assert.equal(dues.length, 2);
  });

  it("同じ接種日が2件ならあとから入れた（id が大きい）ほうを最新とする", () => {
    const older: VaccinationRecord = { id: 1, date: "2026-05-03", name: "混合", nextDueDate: "2027-05-03" };
    const newer: VaccinationRecord = { id: 2, date: "2026-05-03", name: "混合", nextDueDate: "2027-06-01" };
    assert.deepEqual(
      liveVaccinationDues([older, newer]).map((d) => d.dueDate),
      ["2027-06-01"],
    );
    // 入力の並びに依存しない
    assert.deepEqual(
      liveVaccinationDues([newer, older]).map((d) => d.dueDate),
      ["2027-06-01"],
    );
  });

  it("壊れた日付は無視する", () => {
    assert.deepEqual(liveVaccinationDues([vac("2026-02-30", "混合", "2027-05-03")]), []);
    assert.deepEqual(liveVaccinationDues([vac("2026-05-03", "混合", "2027-13-01")]), []);
  });
});

describe("estimateNextTrimming — 間隔3本そろうまで日付を出さない", () => {
  it("日付3件以下（間隔2本以下）では推定しない", () => {
    assert.equal(estimateNextTrimming([]), null);
    assert.equal(estimateNextTrimming(["2026-08-01"]), null);
    assert.equal(estimateNextTrimming(["2026-08-01", "2026-07-02"]), null);
    assert.equal(estimateNextTrimming(["2026-08-01", "2026-07-02", "2026-05-03"]), null);
  });

  it("日付4件そろえば直近3間隔の中央値で次回を出す（平均ではない）", () => {
    // 間隔は 30 / 60 / 45 → 中央値 45
    const est = estimateNextTrimming([
      "2026-08-01",
      "2026-07-02",
      "2026-05-03",
      "2026-03-19",
    ]);
    assert.ok(est);
    assert.equal(est.intervalDays, 45);
    assert.equal(est.lastDate, "2026-08-01");
    assert.equal(est.nextDate, "2026-09-15");
  });

  it("入力の並びと重複に依存しない", () => {
    const est = estimateNextTrimming([
      "2026-03-19",
      "2026-08-01",
      "2026-05-03",
      "2026-08-01",
      "2026-07-02",
    ]);
    assert.equal(est?.nextDate, "2026-09-15");
  });

  it("間隔が1本でも範囲外なら推定しない（200日の空白を中央値で消さない）", () => {
    // 間隔は 30 / 60 / 200
    assert.equal(
      estimateNextTrimming(["2026-08-01", "2026-07-02", "2026-05-03", "2025-10-15"]),
      null,
    );
    // 間隔は 10 / 30 / 30（短すぎる = 周期ではない）
    assert.equal(
      estimateNextTrimming(["2026-08-01", "2026-07-22", "2026-06-22", "2026-05-23"]),
      null,
    );
  });

  it("下限・上限そのものは範囲に含む", () => {
    const min = estimateNextTrimming([
      "2026-08-01",
      addDays("2026-08-01", -TRIM_MIN_INTERVAL),
      addDays("2026-08-01", -TRIM_MIN_INTERVAL * 2),
      addDays("2026-08-01", -TRIM_MIN_INTERVAL * 3),
    ]);
    assert.equal(min?.intervalDays, TRIM_MIN_INTERVAL);

    const max = estimateNextTrimming([
      "2026-08-01",
      addDays("2026-08-01", -TRIM_MAX_INTERVAL),
      addDays("2026-08-01", -TRIM_MAX_INTERVAL * 2),
      addDays("2026-08-01", -TRIM_MAX_INTERVAL * 3),
    ]);
    assert.equal(max?.intervalDays, TRIM_MAX_INTERVAL);
  });
});

describe("buildHomeSchedule — 何も無い日", () => {
  it("バンドは空、行は3行すべて unset", () => {
    const { urgent, rows } = build({});
    assert.deepEqual(urgent, []);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => [r.kind, r.state, r.fallback]),
      [
        ["heartworm", "unset", "フィラリア ・ 予定なし"],
        ["vaccination", "unset", "ワクチン ・ 次回予定日が未登録"],
        ["trimming", "unset", "トリミング ・ 記録なし"],
      ],
    );
    for (const r of rows) {
      assert.equal(r.date, null);
      assert.equal(r.relative, null);
      assert.equal(r.detail, null);
    }
  });

  it("行の順序と行き先は固定", () => {
    const { rows } = build({});
    assert.deepEqual(
      rows.map((r) => r.href),
      ["/care?tab=heartworm", "/calendar?tab=vaccination", "/care"],
    );
  });
});

describe("buildHomeSchedule — 緊急バンド（過ぎている / 当日）", () => {
  it("未実施の予定が1件過ぎている", () => {
    const { urgent } = build({
      doses: [dose("2026-08-28", { label: "モキシデック チュアブル" })],
    });
    assert.equal(urgent.length, 1);
    assert.equal(urgent[0].kind, "heartworm");
    assert.equal(urgent[0].overdue, true);
    assert.equal(urgent[0].title, "フィラリアが3日おくれています");
    assert.equal(urgent[0].detail, "8月28日の予定 ・ モキシデック チュアブル");
    assert.equal(urgent[0].dose?.scheduledDate, "2026-08-28");
  });

  it("薬が未登録でも detail が空にならない", () => {
    const { urgent } = build({ doses: [dose("2026-08-28")] });
    assert.equal(urgent[0].detail, "8月28日の予定");
  });

  it("2件以上は1行に畳み、いちばん古い予定に「飲ませた」を付ける", () => {
    const { urgent } = build({
      doses: [dose("2026-08-28"), dose("2026-07-28", { label: "モキシデック" })],
    });
    assert.equal(urgent.length, 1);
    assert.equal(urgent[0].title, "フィラリアの未投薬が2件あります");
    assert.equal(urgent[0].detail, "いちばん古いのは7月28日（34日おくれ）");
    assert.equal(urgent[0].dose?.scheduledDate, "2026-07-28");
  });

  it("当日は失敗ではないので overdue にしない", () => {
    const { urgent } = build({ doses: [dose(TODAY, { label: "モキシデック" })] });
    assert.equal(urgent.length, 1);
    assert.equal(urgent[0].overdue, false);
    assert.equal(urgent[0].title, "きょうはフィラリアの日");
    assert.equal(urgent[0].detail, "モキシデック");
  });

  it("飲ませた記録がある予定はバンドに出ない", () => {
    const { urgent } = build({
      doses: [dose("2026-08-28", { givenDate: "2026-08-29" }), dose(TODAY, { givenDate: TODAY })],
    });
    assert.deepEqual(urgent, []);
  });

  it("未来の予定はバンドに出ない", () => {
    const { urgent } = build({ doses: [dose("2026-09-15")] });
    assert.deepEqual(urgent, []);
  });

  it("生きているワクチン予定日が過ぎている", () => {
    const { urgent } = build({
      vaccineSchedule: [vac("2025-05-03", "6種混合ワクチン", "2026-05-03")],
    });
    assert.equal(urgent.length, 1);
    assert.equal(urgent[0].kind, "vaccination");
    assert.equal(urgent[0].overdue, true);
    assert.equal(urgent[0].title, "ワクチンの予定日をすぎています");
    assert.equal(urgent[0].detail, "6種混合ワクチン ・ 5月3日の予定");
    assert.equal(urgent[0].dose, null);
  });

  it("過ぎている系統が複数あっても1行だけ。出すのは予定日がいちばん新しいもの", () => {
    const { urgent } = build({
      vaccineSchedule: [
        vac("2024-05-03", "6種混合", "2025-05-03"),
        vac("2025-05-03", "6種混合ワクチン", "2026-05-03"),
        vac("2024-04-01", "狂犬病予防注射", "2025-04-01"),
      ],
    });
    const overdue = urgent.filter((u) => u.kind === "vaccination" && u.overdue);
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].detail, "6種混合ワクチン ・ 5月3日の予定");
  });

  it("ワクチンの当日", () => {
    const { urgent } = build({
      vaccineSchedule: [vac("2025-08-31", "6種混合ワクチン", TODAY)],
    });
    assert.equal(urgent[0].title, "きょうはワクチンの予定日");
    assert.equal(urgent[0].detail, "6種混合ワクチン");
    assert.equal(urgent[0].overdue, false);
  });

  it("並びは フィラリア過ぎ → フィラリア当日 → ワクチン過ぎ で、最大3件", () => {
    const { urgent } = build({
      doses: [dose("2026-08-28"), dose(TODAY)],
      vaccineSchedule: [
        vac("2025-05-03", "6種混合ワクチン", "2026-05-03"),
        vac("2025-08-31", "狂犬病予防注射", TODAY),
      ],
    });
    assert.equal(urgent.length, MAX_URGENT);
    assert.deepEqual(
      urgent.map((u) => [u.kind, u.overdue]),
      [
        ["heartworm", true],
        ["heartworm", false],
        ["vaccination", true],
      ],
    );
    // key は種類だけでは足りない（同じ種類が2行出る）
    assert.equal(new Set(urgent.map((u) => u.key)).size, urgent.length);
  });
});

describe("buildHomeSchedule — バンドに出た種類は行で二度言わない", () => {
  it("フィラリアが過ぎていても、行は次の未来の予定を出す", () => {
    const { urgent, rows } = build({
      doses: [dose("2026-08-28"), dose("2026-09-15", { label: "モキシデック" })],
    });
    assert.equal(urgent.length, 1);
    const row = rowOf(rows, "heartworm");
    assert.equal(row.state, "due");
    assert.equal(row.date, "2026-09-15");
    assert.equal(row.relative, "あと15日");
    assert.equal(row.detail, "モキシデック");
  });

  it("バンドが当日ぶんも持っているので、行は today も飛ばす", () => {
    const { rows } = build({ doses: [dose(TODAY), dose("2026-09-15")] });
    assert.equal(rowOf(rows, "heartworm").date, "2026-09-15");
  });

  it("未来の予定が無ければ行は unset に落ちる（過ぎているとは言わない）", () => {
    const { urgent, rows } = build({ doses: [dose("2026-08-28")] });
    assert.equal(urgent.length, 1);
    const row = rowOf(rows, "heartworm");
    assert.equal(row.state, "unset");
    assert.equal(row.date, null);
    assert.equal(row.fallback, "フィラリア ・ 予定なし");
  });

  it("ワクチンも同じ（バンドに出たら行は未来だけ）", () => {
    const withFuture = build({
      vaccineSchedule: [
        vac("2025-05-03", "6種混合ワクチン", "2026-05-03"),
        vac("2026-04-01", "狂犬病予防注射", "2027-04-01"),
      ],
    });
    assert.equal(withFuture.urgent.length, 1);
    assert.equal(rowOf(withFuture.rows, "vaccination").date, "2027-04-01");

    const withoutFuture = build({
      vaccineSchedule: [vac("2025-05-03", "6種混合ワクチン", "2026-05-03")],
    });
    assert.equal(rowOf(withoutFuture.rows, "vaccination").state, "unset");
  });

  it("バンドに出た種類の行は、どの入力でも「すぎています」と言わない", () => {
    const cases: Parameters<typeof build>[0][] = [
      { doses: [dose("2026-08-28")] },
      { doses: [dose("2026-07-28"), dose("2026-08-28"), dose("2026-09-15")] },
      { doses: [dose(TODAY)] },
      { vaccineSchedule: [vac("2025-05-03", "6種混合ワクチン", "2026-05-03")] },
      {
        doses: [dose("2026-08-28"), dose(TODAY), dose("2026-09-15")],
        vaccineSchedule: [
          vac("2025-05-03", "6種混合ワクチン", "2026-05-03"),
          vac("2025-08-31", "狂犬病予防注射", TODAY),
        ],
      },
    ];
    for (const input of cases) {
      const { urgent, rows } = build(input);
      for (const kind of new Set(urgent.map((u) => u.kind))) {
        const row = rowOf(rows, kind);
        assert.ok(row.date === null || row.date > TODAY, `${kind}: ${row.date}`);
        assert.ok(!(row.relative ?? "").includes("すぎ"), `${kind}: ${row.relative}`);
        assert.ok(!(row.fallback ?? "").includes("すぎ"), `${kind}: ${row.fallback}`);
      }
    }
  });

  it("バンドに出ていない種類は、過去の未実施を最優先で出す", () => {
    // urgent が空になる today（予定日より前）を渡す = バンド無しの状態
    const { urgent, rows } = build(
      { doses: [dose("2026-08-28", { label: "モキシデック" })] },
      "2026-08-01",
    );
    assert.deepEqual(urgent, []);
    const row = rowOf(rows, "heartworm");
    assert.equal(row.date, "2026-08-28");
    assert.equal(row.relative, "あと27日");
  });

  it("バンドが無ければワクチンの行は today も出せる", () => {
    // liveVaccinationDues の予定日が today でも、当日はバンドが持つので
    // 行からは消える。バンドが無い状態を作るには未来の予定だけを渡す
    const { rows } = build({
      vaccineSchedule: [vac("2026-08-01", "6種混合ワクチン", "2026-09-01")],
    });
    const row = rowOf(rows, "vaccination");
    assert.equal(row.state, "due");
    assert.equal(row.date, "2026-09-01");
    assert.equal(row.relative, "あすです");
    assert.equal(row.detail, "6種混合ワクチン");
  });
});

describe("buildHomeSchedule — トリミングの行", () => {
  it("記録が1〜3件なら観測だけを言う（推定を捏造しない）", () => {
    const { rows } = build({ trimmingDates: ["2026-07-12"] });
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "observed");
    assert.equal(row.date, null);
    assert.equal(row.relative, null);
    assert.equal(row.detail, "前回 7月12日（50日前）");

    const three = build({
      trimmingDates: ["2026-07-12", "2026-06-01", "2026-04-20"],
    });
    assert.equal(rowOf(three.rows, "trimming").state, "observed");
  });

  it("4件そろえば「目安」の日付と根拠を出す", () => {
    const { rows } = build({
      trimmingDates: ["2026-08-01", "2026-07-02", "2026-05-03", "2026-03-19"],
    });
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "estimate");
    assert.equal(row.date, "2026-09-15");
    assert.equal(row.relative, "あと15日");
    assert.equal(row.detail, "前回 8月1日から約45日ごと");
  });

  it("目安が過ぎていたら日付を出さず「そろそろの時期です」", () => {
    const { rows } = build({
      trimmingDates: ["2026-05-01", "2026-04-01", "2026-03-02", "2026-01-31"],
    });
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "estimate");
    assert.equal(row.date, null);
    assert.equal(row.relative, null);
    assert.equal(row.fallback, "そろそろの時期です");
    assert.equal(row.detail, "前回 5月1日から約30日ごと");
  });

  it("間隔が範囲外なら observed に落ちる", () => {
    const { rows } = build({
      trimmingDates: ["2026-08-01", "2026-07-02", "2026-05-03", "2025-10-15"],
    });
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "observed");
    assert.equal(row.detail, "前回 8月1日（30日前）");
  });

  it("今日トリミングしたら「0日前」ではなく「今日」", () => {
    const { rows } = build({ trimmingDates: [TODAY] });
    assert.equal(rowOf(rows, "trimming").detail, "前回 8月31日（今日）");
  });

  it("きのうトリミングしたら「きのう」", () => {
    const { rows } = build({ trimmingDates: ["2026-08-30"] });
    assert.equal(rowOf(rows, "trimming").detail, "前回 8月30日（きのう）");
  });

  it("トリミングはバンドに出ない", () => {
    const { urgent } = build({ trimmingDates: ["2026-05-01", "2026-04-01", "2026-03-02", "2026-01-31"] });
    assert.deepEqual(urgent, []);
  });

  it("今日より先の日付が「前回」に混ざっても周期の材料にしない", () => {
    // 4件そろっているように見えるが、先頭は予約（未来）。3件の観測として扱う
    const { rows } = build({
      trimmingDates: ["2026-09-20", "2026-08-01", "2026-07-02", "2026-05-03"],
    });
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "observed");
    assert.equal(row.detail, "前回 8月1日（30日前）");
  });
});

describe("buildHomeSchedule — トリミングの予約", () => {
  it("予約があれば目安ではなく本物の予定として出す（時間とお店を3行目に）", () => {
    const { urgent, rows } = build({
      trimmingDates: ["2026-08-01", "2026-07-02", "2026-05-03", "2026-03-19"],
      trimmingReservations: [{ date: "2026-09-10", time: "14:00", place: "サロン◯◯" }],
    });
    assert.deepEqual(urgent, []);
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "due");
    assert.equal(row.date, "2026-09-10");
    assert.equal(row.relative, "あと10日");
    assert.equal(row.fallback, null);
    assert.equal(row.detail, "14:00 ・ サロン◯◯");
    assert.equal(row.href, "/care");
  });

  it("時間もお店も無い予約は3行目を出さない（「 ・ 」を浮かせない）", () => {
    const { rows } = build({
      trimmingReservations: [{ date: "2026-09-10", time: null, place: null }],
    });
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "due");
    assert.equal(row.detail, null);

    const onlyPlace = build({
      trimmingReservations: [{ date: "2026-09-10", time: null, place: "サロン◯◯" }],
    });
    assert.equal(rowOf(onlyPlace.rows, "trimming").detail, "サロン◯◯");
  });

  it("今日の予約は「今日」（行は当日ぶんも持つ。バンドには出ない）", () => {
    const { urgent, rows } = build({
      trimmingReservations: [{ date: TODAY, time: "10:30", place: null }],
    });
    assert.deepEqual(urgent, []);
    const row = rowOf(rows, "trimming");
    assert.equal(row.date, TODAY);
    assert.equal(row.relative, "今日");
    assert.equal(row.detail, "10:30");
  });

  it("複数あれば近いほう。同じ日なら早い時間", () => {
    const { rows } = build({
      trimmingReservations: [
        { date: "2026-10-01", time: null, place: "来月" },
        { date: "2026-09-10", time: "15:00", place: "午後" },
        { date: "2026-09-10", time: "09:00", place: "午前" },
      ],
    });
    assert.equal(rowOf(rows, "trimming").detail, "09:00 ・ 午前");
  });

  it("過ぎた予約は無視する（行ったものとみなす。「すぎています」を言わない）", () => {
    const { rows } = build({
      trimmingReservations: [{ date: "2026-08-25", time: "14:00", place: "サロン◯◯" }],
    });
    const row = rowOf(rows, "trimming");
    assert.equal(row.state, "unset");
    assert.equal(row.fallback, "トリミング ・ 記録なし");
  });

  it("壊れた日付の予約は無視する", () => {
    const { rows } = build({
      trimmingReservations: [{ date: "2026-09-31", time: null, place: null }],
    });
    assert.equal(rowOf(rows, "trimming").state, "unset");
  });
});
