import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultSchedulePlan,
  doseStatus,
  generateDoseDates,
  selectDosesToRemind,
  type DoseRow,
} from "./heartworm";

const gen = (startMonth: string, endMonth: string, dayOfMonth: number) =>
  generateDoseDates({ startMonth, endMonth, dayOfMonth });

describe("generateDoseDates — 期間指定の一括生成", () => {
  it("5月〜11月の毎月15日", () => {
    const r = gen("2026-05", "2026-11", 15);
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.dates, [
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
    ]);
  });

  it("同じ月だけを指定しても1件作る", () => {
    const r = gen("2026-05", "2026-05", 1);
    assert.deepEqual(r.ok && r.dates, ["2026-05-01"]);
  });

  it("年をまたぐ", () => {
    const r = gen("2026-11", "2027-02", 3);
    assert.deepEqual(r.ok && r.dates, [
      "2026-11-03",
      "2026-12-03",
      "2027-01-03",
      "2027-02-03",
    ]);
  });

  it("31日を指定した月に31日が無ければ末日に寄せる（飛ばさない）", () => {
    const r = gen("2026-01", "2026-04", 31);
    assert.deepEqual(r.ok && r.dates, [
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("閏年の2月は29日まで", () => {
    const r = gen("2028-02", "2028-02", 31);
    assert.deepEqual(r.ok && r.dates, ["2028-02-29"]);
  });

  it("開始が終了より後ならエラー", () => {
    assert.deepEqual(gen("2026-11", "2026-05", 15), { ok: false, error: "reversed" });
  });

  it("月の形式が不正ならエラー", () => {
    for (const m of ["2026-13", "26-05", "", "2026/05"]) {
      assert.deepEqual(gen(m, "2026-11", 15), { ok: false, error: "invalid-month" });
    }
  });

  it("日が範囲外ならエラー", () => {
    for (const d of [0, 32, -1, 1.5, NaN]) {
      assert.deepEqual(gen("2026-05", "2026-11", d), { ok: false, error: "invalid-day" });
    }
  });

  it("作りすぎを防ぐ", () => {
    assert.deepEqual(gen("2026-01", "2030-12", 1), { ok: false, error: "too-many" });
  });
});

const dose = (
  id: number,
  scheduledDate: string,
  givenDate: string | null = null,
  remindedAt: string | null = null,
): DoseRow => ({ id, scheduledDate, givenDate, remindedAt });

const TODAY = "2026-08-31";

describe("selectDosesToRemind — 1回だけ・正しい日に", () => {
  it("今日の予定を選ぶ", () => {
    const r = selectDosesToRemind([dose(1, TODAY)], TODAY);
    assert.deepEqual(r.map((d) => d.id), [1]);
  });

  it("未来の予定は選ばない", () => {
    assert.deepEqual(selectDosesToRemind([dose(1, "2026-09-01")], TODAY), []);
  });

  it("すでに飲ませた予定は選ばない", () => {
    assert.deepEqual(selectDosesToRemind([dose(1, TODAY, "2026-08-31")], TODAY), []);
  });

  it("すでに送った予定は選ばない（二重送信を防ぐ要）", () => {
    assert.deepEqual(
      selectDosesToRemind([dose(1, TODAY, null, "2026-08-31T08:00:00+09:00")], TODAY),
      [],
    );
  });

  it("cronが止まっていた日を取り戻す（既定7日前まで）", () => {
    const r = selectDosesToRemind(
      [dose(1, "2026-08-25"), dose(2, "2026-08-29")],
      TODAY,
    );
    assert.deepEqual(r.map((d) => d.id), [1, 2]);
  });

  it("遡りすぎない（8日前は拾わない）", () => {
    assert.deepEqual(selectDosesToRemind([dose(1, "2026-08-23")], TODAY), []);
  });

  it("遡る日数を0にすると今日ぶんだけ", () => {
    const r = selectDosesToRemind([dose(1, "2026-08-30"), dose(2, TODAY)], TODAY, 0);
    assert.deepEqual(r.map((d) => d.id), [2]);
  });

  it("古い順に並べる", () => {
    const r = selectDosesToRemind(
      [dose(3, "2026-08-30"), dose(1, "2026-08-26"), dose(2, "2026-08-28")],
      TODAY,
    );
    assert.deepEqual(r.map((d) => d.id), [1, 2, 3]);
  });

  it("壊れた日付では何も選ばない", () => {
    assert.deepEqual(selectDosesToRemind([dose(1, "2026-13-01")], TODAY), []);
    assert.deepEqual(selectDosesToRemind([dose(1, TODAY)], "きょう"), []);
  });
});

describe("doseStatus", () => {
  it("状態を返す", () => {
    assert.equal(doseStatus({ scheduledDate: TODAY, givenDate: "2026-08-31" }, TODAY), "given");
    assert.equal(doseStatus({ scheduledDate: TODAY, givenDate: null }, TODAY), "today");
    assert.equal(doseStatus({ scheduledDate: "2026-08-01", givenDate: null }, TODAY), "overdue");
    assert.equal(doseStatus({ scheduledDate: "2026-09-15", givenDate: null }, TODAY), "upcoming");
  });
});

describe("defaultSchedulePlan — 過ぎた日を既定で提案しない", () => {
  it("シーズン前（3月）なら今年の5月から", () => {
    assert.deepEqual(defaultSchedulePlan("2026-03-10"), {
      startMonth: "2026-05",
      endMonth: "2026-11",
      dayOfMonth: 10,
    });
  });

  it("シーズン中（8月）なら今月から。5月に戻らない", () => {
    assert.deepEqual(defaultSchedulePlan("2026-08-31"), {
      startMonth: "2026-08",
      endMonth: "2026-11",
      dayOfMonth: 31,
    });
  });

  it("シーズン頭（5月）なら5月から", () => {
    assert.deepEqual(defaultSchedulePlan("2026-05-01"), {
      startMonth: "2026-05",
      endMonth: "2026-11",
      dayOfMonth: 1,
    });
  });

  it("シーズン最終月（11月）なら11月だけ", () => {
    assert.deepEqual(defaultSchedulePlan("2026-11-20"), {
      startMonth: "2026-11",
      endMonth: "2026-11",
      dayOfMonth: 20,
    });
  });

  it("シーズン後（12月）なら翌年の5月から", () => {
    assert.deepEqual(defaultSchedulePlan("2026-12-05"), {
      startMonth: "2027-05",
      endMonth: "2027-11",
      dayOfMonth: 5,
    });
  });

  it("既定値がそのまま生成に通り、過去の日を含まない", () => {
    for (const today of ["2026-03-10", "2026-08-31", "2026-11-20", "2026-12-05"]) {
      const plan = defaultSchedulePlan(today);
      const r = generateDoseDates(plan);
      assert.equal(r.ok, true, today);
      const past = r.ok ? r.dates.filter((d) => d < today) : [];
      assert.deepEqual(past, [], `${today} の既定値が過去の日を作った: ${past.join(",")}`);
    }
  });
});
