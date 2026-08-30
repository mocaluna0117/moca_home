import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  buildMonthGrid,
  daysInMonth,
  foodKey,
  formatDayLabel,
  formatMonthLabel,
  isDateOnly,
  isMealSlot,
  monthRange,
  parseYearMonth,
  shiftMonth,
  todayJst,
  weekdayOf,
  yearMonthOf,
} from "./calendar";

describe("isDateOnly — 実在する暦日まで検証", () => {
  it("正しい日付を通す", () => {
    for (const d of ["2026-08-30", "2024-02-29", "2000-01-01", "2100-12-31"]) {
      assert.equal(isDateOnly(d), true, d);
    }
  });
  it("存在しない日付を弾く", () => {
    for (const d of ["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-10", "2026-08-32"]) {
      assert.equal(isDateOnly(d), false, d);
    }
  });
  it("書式違い・範囲外を弾く", () => {
    for (const d of ["2026-8-30", "20260830", "2026-08-30T00:00", "", "1999-01-01", null, 20260830]) {
      assert.equal(isDateOnly(d), false, String(d));
    }
  });
});

describe("daysInMonth — 閏年", () => {
  it("2月", () => {
    assert.equal(daysInMonth(2024, 2), 29); // 閏年
    assert.equal(daysInMonth(2025, 2), 28);
    assert.equal(daysInMonth(2000, 2), 29); // 400で割り切れる
    assert.equal(daysInMonth(2100, 2), 28); // 100で割り切れるが400では割れない
  });
  it("30日/31日の月", () => {
    assert.equal(daysInMonth(2026, 4), 30);
    assert.equal(daysInMonth(2026, 12), 31);
  });
});

describe("parseYearMonth", () => {
  it("正しい値", () => {
    assert.equal(parseYearMonth("2026-08"), "2026-08");
    assert.equal(parseYearMonth("2026-01"), "2026-01");
    assert.equal(parseYearMonth("2026-12"), "2026-12");
  });
  it("不正な値は null（呼び出し側が今月にフォールバックする）", () => {
    for (const v of ["2026-13", "2026-00", "2026-8", "zzz", "", undefined, null, "1999-05"]) {
      assert.equal(parseYearMonth(v as string | undefined), null, String(v));
    }
  });
});

describe("shiftMonth — 年跨ぎ", () => {
  it("前後1か月", () => {
    assert.equal(shiftMonth("2026-08", 1), "2026-09");
    assert.equal(shiftMonth("2026-08", -1), "2026-07");
  });
  it("12月→翌年1月 / 1月→前年12月", () => {
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
  });
  it("複数月", () => {
    assert.equal(shiftMonth("2026-08", 12), "2027-08");
    assert.equal(shiftMonth("2026-08", -12), "2025-08");
  });
});

describe("monthRange — SQL の範囲指定", () => {
  it("通常の月", () => {
    assert.deepEqual(monthRange("2026-08"), {
      start: "2026-08-01",
      endExclusive: "2026-09-01",
    });
  });
  it("12月は翌年1月1日で閉じる", () => {
    assert.deepEqual(monthRange("2026-12"), {
      start: "2026-12-01",
      endExclusive: "2027-01-01",
    });
  });
  it("不正な月は null", () => assert.equal(monthRange("2026-13"), null));
});

describe("addDays — 月跨ぎ・年跨ぎ・閏日", () => {
  it("月末を跨ぐ", () => {
    assert.equal(addDays("2026-08-31", 1), "2026-09-01");
    assert.equal(addDays("2026-09-01", -1), "2026-08-31");
  });
  it("年を跨ぐ", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  });
  it("閏日", () => {
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
    assert.equal(addDays("2025-02-28", 1), "2025-03-01");
  });
  it("0日は変化しない", () => assert.equal(addDays("2026-08-30", 0), "2026-08-30"));
});

describe("weekdayOf", () => {
  it("既知の曜日", () => {
    assert.equal(weekdayOf("2026-08-30"), 0); // 日
    assert.equal(weekdayOf("2026-08-31"), 1); // 月
    assert.equal(weekdayOf("2026-08-29"), 6); // 土
  });
});

describe("buildMonthGrid", () => {
  it("マス数は必ず7の倍数で、月の全日が含まれる", () => {
    for (const ym of ["2026-08", "2026-02", "2024-02", "2026-11", "2027-01"]) {
      const g = buildMonthGrid(ym)!;
      const flat = g.weeks.flat();
      assert.equal(flat.length % 7, 0, ym);
      const inMonth = flat.filter((d) => d.inMonth);
      const y = Number(ym.slice(0, 4));
      const mo = Number(ym.slice(5, 7));
      assert.equal(inMonth.length, daysInMonth(y, mo), ym);
      assert.equal(inMonth[0].date, `${ym}-01`, ym);
    }
  });

  it("日曜始まりで、各週の先頭は日曜", () => {
    const g = buildMonthGrid("2026-08")!;
    for (const w of g.weeks) assert.equal(w[0].weekday, 0);
  });

  it("日付が連続している（穴も重複もない）", () => {
    const flat = buildMonthGrid("2026-08")!.weeks.flat();
    for (let i = 1; i < flat.length; i++) {
      assert.equal(flat[i].date, addDays(flat[i - 1].date, 1));
    }
  });

  it("6週になる月も5週の月も正しく扱う", () => {
    // 2026-08-01 は土曜 → 前に6日こぼれる → 6週になる
    assert.equal(buildMonthGrid("2026-08")!.weeks.length, 6);
    // 2026-02-01 は日曜、28日 → ちょうど4週
    assert.equal(buildMonthGrid("2026-02")!.weeks.length, 4);
  });

  it("前後月・ラベル", () => {
    const g = buildMonthGrid("2026-01")!;
    assert.equal(g.prev, "2025-12");
    assert.equal(g.next, "2026-02");
    assert.equal(g.label, "2026年1月");
  });

  it("不正な月は null", () => assert.equal(buildMonthGrid("2026-13"), null));
});

describe("表示ヘルパ", () => {
  it("formatMonthLabel は0埋めしない", () => {
    assert.equal(formatMonthLabel("2026-08"), "2026年8月");
    assert.equal(formatMonthLabel("2026-12"), "2026年12月");
  });
  it("formatDayLabel", () => {
    assert.equal(formatDayLabel("2026-08-30"), "8月30日（日）");
  });
  it("todayJst は +09:00 付き ISO から暦日を取り出す", () => {
    assert.equal(todayJst("2026-08-30T00:47:40+09:00"), "2026-08-30");
  });
  it("yearMonthOf", () => assert.equal(yearMonthOf("2026-08-30"), "2026-08"));
});

describe("isMealSlot / foodKey", () => {
  it("スロット", () => {
    for (const s of ["morning", "evening", "treat"]) assert.equal(isMealSlot(s), true);
    for (const s of ["lunch", "", null, 1]) assert.equal(isMealSlot(s), false);
  });
  it("foodKey は getProductSummaries と同じ規約", () => {
    assert.equal(foodKey(320, "ペロリ"), "p:320");
    assert.equal(foodKey(null, "手作りごはん"), "n:手作りごはん");
  });
});
