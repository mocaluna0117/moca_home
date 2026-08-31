import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ageLabel,
  formatWeight,
  isDogSex,
  nextAnniversary,
  parseWeightKg,
  photoVersion,
  todayHighlight,
  togetherDaysLabel,
} from "./profile";

describe("parseWeightKg — kg 1桁小数の入力を整数グラムに", () => {
  it("半角・全角・kg 付きが同じ値になる", () => {
    for (const raw of ["5.2", "５．２", "5.2kg", "５．２ｋｇ", " 5.2 kg ", "5.2KG", "5.2　kg"]) {
      assert.equal(parseWeightKg(raw), 5200, raw);
    }
    assert.equal(parseWeightKg("5"), 5000);
    assert.equal(parseWeightKg("5.0"), 5000);
    // 数値で来ても浮動小数の誤差を作らない
    assert.equal(parseWeightKg(5.2), 5200);
  });

  it("小数第2位以下は丸めずに拒否する", () => {
    for (const raw of ["5.25", "5.199", "0.05"]) {
      assert.equal(parseWeightKg(raw), null, raw);
    }
  });

  it("空・読めない値は null（0 にしない）", () => {
    for (const raw of ["", "   ", "kg", "abc", "5,2", "-5.2", ".5", "5.", null, undefined, {}, NaN]) {
      assert.equal(parseWeightKg(raw), null, String(raw));
    }
  });

  it("範囲外（0.1kg 未満・120kg 超）は null", () => {
    assert.equal(parseWeightKg("0"), null);
    assert.equal(parseWeightKg("0.0"), null);
    assert.equal(parseWeightKg("121"), null);
    assert.equal(parseWeightKg("999"), null);
    // 境界は通す
    assert.equal(parseWeightKg("0.1"), 100);
    assert.equal(parseWeightKg("120"), 120_000);
  });
});

describe("formatWeight — 測定日を必ず併記する", () => {
  it("測定日ありとなし", () => {
    assert.equal(formatWeight(5200, "2026-06-01"), "5.2kg（6月1日に測定）");
    assert.equal(formatWeight(5200, null), "5.2kg");
    assert.equal(formatWeight(5200, "2026-06-31"), "5.2kg"); // 実在しない日は日付を捨てる
    assert.equal(formatWeight(5000), "5.0kg"); // 末尾の .0 を落とさない
    assert.equal(formatWeight(5990), "6.0kg"); // 100g 単位に丸めても桁が壊れない
  });

  it("体重が無い行は null（ヒーローは行ごと出さない）", () => {
    assert.equal(formatWeight(null), null);
    assert.equal(formatWeight(undefined), null);
    assert.equal(formatWeight(0), null);
  });
});

describe("ageLabel — 誕生日から毎回計算する", () => {
  it("誕生日の前日と当日", () => {
    assert.equal(ageLabel("2022-08-31", "2026-08-30"), "3歳11か月");
    assert.equal(ageLabel("2022-08-31", "2026-08-31"), "4歳");
    assert.equal(ageLabel("2022-08-31", "2026-09-01"), "4歳");
  });

  it("歳と月", () => {
    assert.equal(ageLabel("2022-06-15", "2026-08-31"), "4歳2か月");
    assert.equal(ageLabel("2025-08-31", "2026-08-31"), "1歳");
  });

  it("1歳未満は「生後Nか月」、1か月未満は日で数える", () => {
    assert.equal(ageLabel("2025-12-31", "2026-08-31"), "生後8か月");
    assert.equal(ageLabel("2026-07-31", "2026-08-31"), "生後1か月");
    assert.equal(ageLabel("2026-08-16", "2026-08-31"), "生後15日");
    assert.equal(ageLabel("2026-08-31", "2026-08-31"), "生後0日");
  });

  it("月末生まれは末日で1か月（1月31日生まれの2月）", () => {
    assert.equal(ageLabel("2024-01-31", "2024-02-29"), "生後1か月");
    assert.equal(ageLabel("2024-01-31", "2024-02-28"), "生後28日");
  });

  it("2月29日生まれは平年 2月28日に歳を取る", () => {
    assert.equal(ageLabel("2024-02-29", "2025-02-27"), "生後11か月");
    assert.equal(ageLabel("2024-02-29", "2025-02-28"), "1歳");
    assert.equal(ageLabel("2024-02-29", "2028-02-28"), "3歳11か月"); // 2028 は閏年なので 29日まで待つ
    assert.equal(ageLabel("2024-02-29", "2028-02-29"), "4歳");
  });

  it("誕生日が無い・不正・未来なら null", () => {
    assert.equal(ageLabel(null, "2026-08-31"), null);
    assert.equal(ageLabel(undefined, "2026-08-31"), null);
    assert.equal(ageLabel("2026-02-30", "2026-08-31"), null);
    assert.equal(ageLabel("2026/08/01", "2026-08-31"), null);
    assert.equal(ageLabel("2026-09-01", "2026-08-31"), null);
  });
});

describe("nextAnniversary — 2月29日は平年 2月28日", () => {
  it("平年は 2月28日、閏年は 2月29日", () => {
    assert.equal(nextAnniversary("2024-02-29", "2026-01-01"), "2026-02-28");
    assert.equal(nextAnniversary("2024-02-29", "2027-02-01"), "2027-02-28");
    assert.equal(nextAnniversary("2024-02-29", "2028-01-01"), "2028-02-29");
    // 平年の記念日を過ぎたら翌年へ
    assert.equal(nextAnniversary("2024-02-29", "2026-03-01"), "2027-02-28");
  });

  it("今日が記念日なら今日を返す", () => {
    assert.equal(nextAnniversary("2022-08-31", "2026-08-31"), "2026-08-31");
    assert.equal(nextAnniversary("2022-08-31", "2026-09-01"), "2027-08-31");
  });

  it("その日そのものは記念日にしない", () => {
    assert.equal(nextAnniversary("2026-08-31", "2026-08-31"), "2027-08-31");
  });

  it("不正な値は null", () => {
    assert.equal(nextAnniversary(null, "2026-08-31"), null);
    assert.equal(nextAnniversary("2025-02-29", "2026-08-31"), null);
  });
});

describe("togetherDaysLabel — おうちに来た日を1日目と数える", () => {
  it("桁区切りを入れる", () => {
    assert.equal(togetherDaysLabel("2022-08-11", "2026-08-31"), "一緒に暮らして1,482日目");
    assert.equal(togetherDaysLabel("2026-08-31", "2026-08-31"), "一緒に暮らして1日目");
  });

  it("無い・未来なら null", () => {
    assert.equal(togetherDaysLabel(null, "2026-08-31"), null);
    assert.equal(togetherDaysLabel("2026-09-01", "2026-08-31"), null);
  });
});

describe("todayHighlight — 出すのは必ず高々1つ", () => {
  const today = "2026-08-31";

  it("誕生日当日が最優先（同じ日に来た記念日より前）", () => {
    assert.deepEqual(todayHighlight({ birthday: "2022-08-31", cameHomeOn: "2022-08-31" }, today), {
      kind: "birthday",
      text: "きょうは4歳の誕生日",
      icon: "cake",
    });
  });

  it("おうちに来た日の記念日", () => {
    assert.deepEqual(todayHighlight({ birthday: "2022-06-15", cameHomeOn: "2023-08-31" }, today), {
      kind: "came-home",
      text: "きょうはおうちに来た日。いっしょに3年",
      icon: "paw",
    });
  });

  it("誕生日まで14日以内", () => {
    assert.deepEqual(todayHighlight({ birthday: "2022-09-12", cameHomeOn: "2022-10-05" }, today), {
      kind: "birthday-soon",
      text: "誕生日まであと12日",
      icon: "cake",
    });
    // 15日先はまだ言わない（毎日出続けると「今日」の意味が薄れる）
    assert.equal(
      todayHighlight({ birthday: "2022-09-15", cameHomeOn: "2022-10-05" }, today)?.kind,
      "together",
    );
  });

  it("どちらも記念日でなければ一緒に暮らした日数、両方無ければ null", () => {
    assert.deepEqual(todayHighlight({ birthday: null, cameHomeOn: "2022-08-11" }, today), {
      kind: "together",
      text: "一緒に暮らして1,482日目",
      icon: "paw",
    });
    assert.equal(todayHighlight({ birthday: null, cameHomeOn: null }, today), null);
    assert.equal(todayHighlight({ birthday: "2026-02-30", cameHomeOn: null }, today), null);
  });
});

describe("photoVersion — ?v= のキャッシュ破り", () => {
  it("数字だけを12桁", () => {
    assert.equal(photoVersion("2026-08-31T12:34:56+09:00"), "202608311234");
    assert.equal(photoVersion("2026-08-31T12:34:56+09:00").length, 12);
    // 同じ入力なら必ず同じ文字列（SSR とクライアントでずれない）
    assert.equal(photoVersion("2026-08-31T12:34:56+09:00"), photoVersion("2026-08-31T12:34:56+09:00"));
  });

  it("null 安全。「?v=」だけの URL を作らない", () => {
    assert.equal(photoVersion(null), "0");
    assert.equal(photoVersion(undefined), "0");
    assert.equal(photoVersion(""), "0");
    assert.equal(photoVersion("いつか"), "0");
  });
});

describe("isDogSex — フォームから来る値の検証", () => {
  it("既知の値だけ通す", () => {
    assert.equal(isDogSex("female"), true);
    assert.equal(isDogSex("male"), true);
    for (const v of ["", "unknown", "FEMALE", null, undefined, 1, {}]) {
      assert.equal(isDogSex(v), false, String(v));
    }
  });
});
