import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeExtraction,
  parseCertificateDate,
  toHalfWidth,
} from "./vaccination-extract";

const TODAY = "2026-08-31";
const d = (v: unknown, monthOnly = false) =>
  parseCertificateDate(v, { allowMonthOnly: monthOnly })?.date ?? null;

describe("parseCertificateDate — 和暦", () => {
  const cases: Array<[string, string | null]> = [
    ["令和8年5月3日", "2026-05-03"],
    ["令和元年5月1日", "2019-05-01"],
    ["令8年5月3日", "2026-05-03"],
    ["R8.5.3", "2026-05-03"],
    ["R8/5/3", "2026-05-03"],
    ["r8-5-3", "2026-05-03"],
    ["平成30年4月1日", "2018-04-01"],
    ["H30.4.1", "2018-04-01"],
    ["平成12年1月8日", "2000-01-08"],
    ["令和８年５月３日", "2026-05-03"], // 全角
    ["接種日: 令和8年5月3日", "2026-05-03"], // 前置きつき
    ["令和8年5月3日 実施", "2026-05-03"],
  ];
  for (const [input, want] of cases) {
    it(`${input} → ${want}`, () => assert.equal(d(input), want));
  }
});

describe("parseCertificateDate — 西暦", () => {
  const cases: Array<[string, string | null]> = [
    ["2026-05-03", "2026-05-03"],
    ["2026/5/3", "2026-05-03"],
    ["2026.5.3", "2026-05-03"],
    ["2026年5月3日", "2026-05-03"],
    ["2026年5月3日(日)", "2026-05-03"],
  ];
  for (const [input, want] of cases) {
    it(`${input} → ${want}`, () => assert.equal(d(input), want));
  }
});

describe("parseCertificateDate — 読めないものは null（誤変換より未入力）", () => {
  const cases: Array<[unknown, string | null]> = [
    ["", null],
    ["不明", null],
    ["8.5.3", null], // 元号が無く西暦か和暦か決められない
    ["平成元年1月8日", null], // 1989年。このアプリの日付は2000〜2100年
    ["昭和64年1月7日", null], // 昭和は元号として扱わない
    ["S60.3.15", null], // "S" を年号と読まない（本文中の英字を誤読しないため）
    ["令和8年2月30日", null], // 実在しない日
    ["2026-13-01", null],
    ["2026-02-30", null],
    [null, null],
    [undefined, null],
    [42, null],
    [{ date: "2026-05-03" }, null],
  ];
  for (const [input, want] of cases) {
    it(`${JSON.stringify(input)} → ${want}`, () => assert.equal(d(input), want));
  }
});

describe("parseCertificateDate — 日が無い証明書", () => {
  it("接種日は日が無ければ採用しない", () => {
    assert.equal(d("令和9年5月"), null);
    assert.equal(d("2027年5月"), null);
  });
  it("次回予定日は1日で補い、approximate を立てる", () => {
    const r = parseCertificateDate("令和9年5月", { allowMonthOnly: true });
    assert.deepEqual(r, { date: "2027-05-01", approximate: true });
  });
  it("日まで書いてあれば approximate は false", () => {
    const r = parseCertificateDate("令和9年5月10日", { allowMonthOnly: true });
    assert.deepEqual(r, { date: "2027-05-10", approximate: false });
  });
});

describe("toHalfWidth", () => {
  it("全角の数字と記号を半角にする", () => {
    assert.equal(toHalfWidth("２０２６／５／３"), "2026/5/3");
    assert.equal(toHalfWidth("令和８年"), "令和8年");
  });
});

describe("normalizeExtraction — 全体", () => {
  it("証明書そのままの値を正規化する", () => {
    const r = normalizeExtraction(
      {
        date: "令和8年5月3日",
        name: "6種混合ワクチン",
        clinic: "さくら動物病院",
        nextDueDate: "令和9年5月",
      },
      TODAY,
    );
    assert.deepEqual(r, {
      date: "2026-05-03",
      name: "6種混合ワクチン",
      clinic: "さくら動物病院",
      nextDueDate: "2027-05-01",
      nextDueDateApproximate: true,
      dropped: [],
    });
  });

  it("接種日が未来なら捨てる（次回予定日の読み違いを疑う）", () => {
    const r = normalizeExtraction({ date: "2027-01-01" }, TODAY);
    assert.equal(r.date, null);
    assert.deepEqual(r.dropped, ["接種日"]);
  });

  it("2000年より前は isDateOnly が通さないので捨てる", () => {
    const r = normalizeExtraction({ date: "1975-01-01" }, TODAY);
    assert.equal(r.date, null);
    assert.deepEqual(r.dropped, ["接種日"]);
  });

  it("次回予定日が接種日より前なら捨てる（保存時に弾かれる値を入れない）", () => {
    const r = normalizeExtraction(
      { date: "2026-05-03", nextDueDate: "2025-05-03" },
      TODAY,
    );
    assert.equal(r.date, "2026-05-03");
    assert.equal(r.nextDueDate, null);
    assert.deepEqual(r.dropped, ["次回予定日"]);
  });

  it("次回予定日が遠すぎるなら捨てる", () => {
    const r = normalizeExtraction({ nextDueDate: "2099-05-01" }, TODAY);
    assert.equal(r.nextDueDate, null);
    assert.deepEqual(r.dropped, ["次回予定日"]);
  });

  it("次回予定日が接種日と同日なら捨てる（同じ行を2度読んだ徴候）", () => {
    const r = normalizeExtraction(
      { date: "2026-05-03", nextDueDate: "2026-05-03" },
      TODAY,
    );
    assert.equal(r.nextDueDate, null);
    assert.deepEqual(r.dropped, ["次回予定日"]);
  });

  it("ワクチン名に電話番号が混ざったら捨てる（PIIをDBに入れない）", () => {
    const r = normalizeExtraction({ name: "6種混合 03-1234-5678" }, TODAY);
    assert.equal(r.name, null);
    assert.deepEqual(r.dropped, ["ワクチン名"]);
  });

  it("動物病院は施設名だけ取り出すので dropped には入らない", () => {
    const r = normalizeExtraction(
      { clinic: "さくら動物病院 〒123-4567 東京都" },
      TODAY,
    );
    assert.equal(r.clinic, "さくら動物病院");
    assert.deepEqual(r.dropped, []);
  });

  it("プレースホルダは空欄として扱い、dropped にも入れない", () => {
    const r = normalizeExtraction({ clinic: "不明", name: "-" }, TODAY);
    assert.equal(r.clinic, null);
    assert.equal(r.name, null);
    assert.deepEqual(r.dropped, []);
  });

  it("鉤括弧と余分な空白を落とす", () => {
    const r = normalizeExtraction({ name: "「6種混合  ワクチン」" }, TODAY);
    assert.equal(r.name, "6種混合 ワクチン");
  });

  it("上限を超える値は切り詰めずに捨てる（誤った名前が残るより空欄がよい）", () => {
    const r = normalizeExtraction({ clinic: "あ".repeat(150) }, TODAY);
    assert.equal(r.clinic, null);
    assert.deepEqual(r.dropped, ["動物病院"]);
  });

  it("何も読み取れなくても壊れない", () => {
    const r = normalizeExtraction({}, TODAY);
    assert.deepEqual(r, {
      date: null,
      name: null,
      clinic: null,
      nextDueDate: null,
      nextDueDateApproximate: false,
      dropped: [],
    });
  });

  it("モデルが型を外した値を返しても落ちず、使えなかった項目は報告する", () => {
    const r = normalizeExtraction(
      { date: 20260503, name: ["6種混合"], clinic: null, nextDueDate: {} },
      TODAY,
    );
    assert.deepEqual(r, {
      date: null,
      name: null,
      clinic: null,
      nextDueDate: null,
      nextDueDateApproximate: false,
      dropped: ["接種日", "次回予定日", "ワクチン名"],
    });
  });
});

describe("実際の証明書で起きる読み取り事故", () => {
  it("長音を含むワクチン名を壊さない（ブースター → ブ-スタ- にしない）", () => {
    for (const v of [
      "ブースター接種",
      "犬ジステンパーウイルス感染症",
      "パルボウイルス感染症",
      "レプトスピラ・コアワクチン",
    ]) {
      assert.equal(normalizeExtraction({ name: v }, TODAY).name, v, v);
    }
  });

  it("数字に挟まれたダッシュだけは半角ハイフンにする", () => {
    assert.equal(toHalfWidth("2026ー5ー3"), "2026-5-3");
    assert.equal(toHalfWidth("ロットA－2481"), "ロットA－2481");
  });

  it("併記された住所・電話・氏名を落とし、施設名だけを残す", () => {
    const cases: Array<[string, string | null]> = [
      ["さくら動物病院 東京都世田谷区北沢2-1-5", "さくら動物病院"],
      ["みどり動物病院 神奈川県横浜市港北区日吉4丁目1番8号", "みどり動物病院"],
      ["さくら動物病院 TEL 03(1234)5678", "さくら動物病院"],
      ["さくら動物病院 電話 0312345678", "さくら動物病院"],
      ["さくら動物病院 〒123-4567", "さくら動物病院"],
      ["さくら動物病院 info@example.com", "さくら動物病院"],
      ["さくら動物病院 院長 田中太郎", "さくら動物病院"],
      ["さくら動物病院 山田花子様", "さくら動物病院"],
      // 肩書きも敬称も無い素の氏名。列挙型の除外では防げなかったケース
      ["さくら動物病院 田中太郎", "さくら動物病院"],
      ["さくら動物病院 山田", "さくら動物病院"],
      ["Sakura Animal Hospital / Owner: Daiki Kimura", "Sakura Animal Hospital"],
      // 住所が先に来る場合は施設名まで含んでしまうので、まるごと捨てる
      ["東京都渋谷区 さくら動物病院", null],
    ];
    for (const [input, want] of cases) {
      assert.equal(normalizeExtraction({ clinic: input }, TODAY).clinic, want, input);
    }
  });

  it("施設を表す語が無ければ採らない（誤った値より空欄）", () => {
    for (const v of ["アニホス", "もみじペットケア", "田中太郎"]) {
      assert.equal(normalizeExtraction({ clinic: v }, TODAY).clinic, null, v);
    }
  });

  it("ふつうの病院名はそのまま通す（過検知していないか）", () => {
    for (const v of [
      "さくら動物病院",
      "アニマルクリニック代々木",
      "みどりペットクリニック",
      "北海道大学動物医療センター",
      "犬猫病院ハロー",
      "さくら動物病院分院",
    ]) {
      assert.equal(normalizeExtraction({ clinic: v }, TODAY).clinic, v, v);
    }
  });

  it("日付が2つ以上ある文字列は採らない（次回を接種日にしない）", () => {
    assert.equal(d("接種日 2025/5/3 次回 2026/5/3"), null);
    assert.equal(d("令和7年5月3日 次回 令和8年5月3日"), null);
  });

  it("同じ日付が2回書かれているだけなら採る", () => {
    assert.equal(d("2026/5/3 (2026/5/3)"), "2026-05-03");
  });
});
