import { daysInMonth, diffDays, isDateOnly, type DateStr } from "./calendar";

/**
 * もかのプロフィールの値と、そこから毎回作り直す表示文字列。
 * DB も React も import しない純モジュール（heartworm.ts / care.ts と同じく
 * tsx --test で単体実行できるようにする）。
 *
 * 日付は calendar.ts と同じ裸の 'YYYY-MM-DD' だけを扱い、Date を跨がせない。
 * 「今日」は必ず引数で受ける — ここで new Date() を呼ぶと、テストで固定でき
 * ないだけでなく、SSR とクライアントで別の日を言う瞬間が生まれる。
 *
 * 年齢・一緒に暮らした日数・記念日を **列として持たない**のがこの
 * モジュールの存在理由。毎日変わる値を保存すると必ず古くなるので、
 * 根拠（誕生日・おうちに来た日）だけを保存し、文字列は表示のたびに作る。
 */

/**
 * dog_profile は常にこの1行だけ。id を固定してあるので書き込みが
 * upsert 1本になり、insert / update の分岐そのものが存在しない。
 */
export const PROFILE_ROW_ID = 1;

/**
 * 行がまだ無いときにヒーローへ出す名前。**既定の名前はここだけ**に置く
 * （DB 側にも default を書くと「既定の住所」が2つになり、片方だけ直す日が来る）。
 */
export const DEFAULT_DOG_NAME = "もか";

export const DOG_SEXES = ["female", "male"] as const;
export type DogSex = (typeof DOG_SEXES)[number];

/**
 * 値とラベルを schema.ts ではなくここに置くのは、Client のダイアログが
 * ラベルを import するときに drizzle を引き込まないため（CareKind と同じ分担）。
 */
export const SEX_LABEL: Record<DogSex, string> = {
  female: "女の子",
  male: "男の子",
};

export function isDogSex(v: unknown): v is DogSex {
  return typeof v === "string" && (DOG_SEXES as readonly string[]).includes(v);
}

/** なまえはヒーローで一番大きく出るので、1行に収まる長さで止める */
export const MAX_NAME_LENGTH = 20;
/** 犬種はマスタを持たない自由入力。「ミニチュア・ダックスフンド」が入る長さ */
export const MAX_BREED_LENGTH = 30;
/** ひとことはこのページを「道具」ではなく「ホームページ」にしている唯一の自由文。2行で読み切れる長さ */
export const MAX_NOTE_LENGTH = 40;

/**
 * 体重は 0.1kg 刻みの整数グラムで持つ（金額と同じ理由で float を使わない）。
 * 下限 0.1kg は「0」や桁の打ち間違いを弾くため、上限 120kg は
 * 犬なら確実に収まる値。単位を間違えて 5200 と打った人はここで止まる。
 */
export const MIN_WEIGHT_G = 100;
export const MAX_WEIGHT_G = 120_000;

/**
 * 誕生日が近いと言い始める日数。これより前から言うと毎日出続けて、
 * 「今日だけの一言」というヒーローの一言の意味が薄れる。
 */
export const BIRTHDAY_SOON_DAYS = 14;

const pad = (n: number) => String(n).padStart(2, "0");

/** 全角 ASCII（！-～）を半角へ。'０' と '.' の距離が 0xfee0 で一定なのを使う */
const toHalfWidth = (s: string) =>
  s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

const numberFormatter = new Intl.NumberFormat("ja-JP");

/** 「6月1日」。曜日は付けない（calendar.ts の formatDayLabel は曜日込みで、測定日に曜日は要らない） */
const monthDayLabel = (date: DateStr) =>
  `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;

/**
 * year年month月の「date と同じ日にち」。その月に無い日は **末日に寄せる**
 * （31日生まれの2月、2月29日生まれの平年）。heartworm.ts の
 * generateDoseDates と同じ寄せ方 — 月をまたいで飛ばすより末日に寄せる。
 */
function sameDayIn(year: number, month: number, date: DateStr): DateStr {
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** date と同じ月日の year 年の日。2月29日生まれは平年 2月28日になる */
function anniversaryIn(year: number, date: DateStr): DateStr {
  return sameDayIn(year, Number(date.slice(5, 7)), date);
}

/**
 * from から to までに満了した月数（どちらも実在する暦日であること前提）。
 *
 * 「同じ日にち」が無い月は末日で満了とみなす（1月31日生まれは2月末で1か月）。
 * 日本の年齢の数え方に合わせてあり、2月29日生まれが平年に歳を取る日も
 * nextAnniversary と同じ 2月28日になる（2箇所で違う日を言わない）。
 */
function fullMonthsBetween(from: DateStr, to: DateStr): number {
  const toYear = Number(to.slice(0, 4));
  const toMonth = Number(to.slice(5, 7));
  const months =
    toYear * 12 + toMonth - (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)));
  // その月の「同じ日にち」に届いていなければ1か月戻す
  return to < sameDayIn(toYear, toMonth, from) ? months - 1 : months;
}

/**
 * 「5.2」「５．２」「5.2kg」を整数グラムにする。読めなければ null。
 *
 * 全角を受けるのは、iPhone の日本語キーボードだと全角数字がそのまま
 * 入るため（vaccination-extract.ts の全角対応と同じ手当て）。
 * 小数第2位以下は **丸めずに拒否する** — 「5.25」を黙って 5.2kg に
 * 直すと、打った値と保存された値が違うことに誰も気づけない。
 */
export function parseWeightKg(raw: unknown): number | null {
  // 数値で来ても文字列と同じ道を通す（5.2 * 1000 の浮動小数誤差を作らない）
  const source = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
  if (typeof source !== "string") return null;

  const text = toHalfWidth(source)
    .replace(/\s+/g, "") // \s は全角空白（U+3000）も含むので、これで「5.2　kg」も通る
    .replace(/kg$/i, "");
  const m = /^(\d{1,3})(?:\.(\d))?$/.exec(text);
  if (!m) return null;

  const grams = Number(m[1]) * 1000 + Number(m[2] ?? 0) * 100;
  return grams >= MIN_WEIGHT_G && grams <= MAX_WEIGHT_G ? grams : null;
}

/**
 * 「5.2kg（6月1日に測定）」。測定日が無い行は「5.2kg」だけ。
 *
 * 測定日を必ず併記するのは、体重は「いつの値か」が無いと黙って古い値を
 * 真実として出し続けるため。末尾の .0 は落とさない（0.1kg 刻みで記録して
 * いることが読み取れる。「5kg」は目分量の概算に見える）。
 */
export function formatWeight(
  weightGrams: number | null | undefined,
  weighedOn?: DateStr | null,
): string | null {
  if (typeof weightGrams !== "number" || !Number.isFinite(weightGrams) || weightGrams <= 0) {
    return null;
  }
  // 100g 単位に丸めてから桁を分ける（5990 を "5.10kg" にしない）
  const tenths = Math.round(weightGrams / 100);
  const kg = `${Math.floor(tenths / 10)}.${tenths % 10}kg`;
  return isDateOnly(weighedOn) ? `${kg}（${monthDayLabel(weighedOn)}に測定）` : kg;
}

/**
 * 「4歳2か月」/「4歳」/「生後8か月」/「生後15日」。
 * 誕生日が無い・不正・未来なら null（ヒーローは行ごと出さない）。
 *
 * 1歳未満を「0歳」と言わないのは、子犬の1か月がいちばん変化する時期で、
 * 飼い主が数えているのも月と日だから。1か月未満は日で数える
 * （「生後0か月」は何も言っていない）。
 */
export function ageLabel(
  birthday: DateStr | null | undefined,
  today: DateStr,
): string | null {
  if (!isDateOnly(birthday) || !isDateOnly(today) || birthday > today) return null;

  const months = fullMonthsBetween(birthday, today);
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    return rest === 0 ? `${years}歳` : `${years}歳${rest}か月`;
  }
  if (months >= 1) return `生後${months}か月`;
  return `生後${diffDays(birthday, today)}日`;
}

/**
 * 「一緒に暮らして1,482日目」。おうちに来た日を1日目と数える
 * （0日目と言われて嬉しい人はいない）。
 */
export function togetherDaysLabel(
  cameHomeOn: DateStr | null | undefined,
  today: DateStr,
): string | null {
  if (!isDateOnly(cameHomeOn) || !isDateOnly(today) || cameHomeOn > today) return null;
  const days = diffDays(cameHomeOn, today) + 1;
  return `一緒に暮らして${numberFormatter.format(days)}日目`;
}

/**
 * today が date の記念日か。**date 当日そのものは記念日にしない**
 * （生まれた当日に「0歳の誕生日」と言わないため。1年目から数える）。
 *
 * 2月29日生まれは平年 2月28日が記念日（閏年は 2月29日のまま。その年に
 * 29日が在るなら 28日を記念日にはしない）。
 */
export function isAnniversaryToday(
  date: DateStr | null | undefined,
  today: DateStr,
): boolean {
  if (!isDateOnly(date) || !isDateOnly(today) || today <= date) return false;
  return anniversaryIn(Number(today.slice(0, 4)), date) === today;
}

/**
 * today 以降で最初に来る date の記念日。今日が記念日なら **今日**を返す
 * （呼び出し側が diffDays(today, next) をそのまま「あとN日」に使える）。
 * date 当日そのものは含めない — isAnniversaryToday と同じ約束。
 *
 * 2月29日は平年 2月28日に寄せる（heartworm.ts の末日寄せと同じ作法）。
 */
export function nextAnniversary(
  date: DateStr | null | undefined,
  today: DateStr,
): DateStr | null {
  if (!isDateOnly(date) || !isDateOnly(today)) return null;
  // date が未来の行（不正データ）でも、date より前の日を返さないように起点を揃える
  const startYear = Math.max(Number(today.slice(0, 4)), Number(date.slice(0, 4)));
  for (let year = startYear; year <= startYear + 1; year++) {
    const candidate = anniversaryIn(year, date);
    if (candidate >= today && candidate > date) return candidate;
  }
  return null; // 2年ぶん見れば必ず見つかるので到達しない
}

/** todayHighlight が見る2列だけ。DogProfile 行をそのまま渡せる（drizzle を import しないための構造的な受け口） */
export interface ProfileDates {
  birthday: DateStr | null;
  cameHomeOn: DateStr | null;
}

export type HighlightKind = "birthday" | "came-home" | "birthday-soon" | "together";

export interface TodayHighlight {
  kind: HighlightKind;
  /** そのまま描く1行 */
  text: string;
  /** 描く側のアイコン選択。純モジュールなのでコンポーネントは返さない */
  icon: "cake" | "paw";
}

/**
 * ヒーローに出す今日の一言。**必ず高々1つ**。
 * 優先順は 誕生日当日 > おうちに来た日の記念日当日 > 誕生日まで14日以内 >
 * 一緒に暮らしてN日目 > 無し。
 *
 * 2つ並べると「今日の特別」が薄まるので、ここで1つに決めきる
 * （描く側に「どれを出すか」を残さない）。
 */
export function todayHighlight(
  dates: ProfileDates,
  today: DateStr,
): TodayHighlight | null {
  const { birthday, cameHomeOn } = dates;

  if (isDateOnly(birthday) && isAnniversaryToday(birthday, today)) {
    const years = Math.floor(fullMonthsBetween(birthday, today) / 12);
    return { kind: "birthday", text: `きょうは${years}歳の誕生日`, icon: "cake" };
  }
  if (isDateOnly(cameHomeOn) && isAnniversaryToday(cameHomeOn, today)) {
    const years = Math.floor(fullMonthsBetween(cameHomeOn, today) / 12);
    return {
      kind: "came-home",
      text: `きょうはおうちに来た日。いっしょに${years}年`,
      icon: "paw",
    };
  }
  if (isDateOnly(birthday) && birthday <= today) {
    const next = nextAnniversary(birthday, today);
    const days = next === null ? null : diffDays(today, next);
    if (days !== null && days >= 0 && days <= BIRTHDAY_SOON_DAYS) {
      return { kind: "birthday-soon", text: `誕生日まであと${days}日`, icon: "cake" };
    }
  }
  const together = togetherDaysLabel(cameHomeOn, today);
  return together === null ? null : { kind: "together", text: together, icon: "paw" };
}

/** ?v= の桁数。分まであれば足りる（同じ分に2回差し替えても、古い写真はもう消えている） */
const PHOTO_VERSION_DIGITS = 12;

/**
 * 「2026-08-31T12:34:56+09:00」→「202608311234」。
 * /api/dog-photo?v=… のキャッシュ破りだけに使う。
 *
 * 数字を抜いて切るだけなので SSR とクライアントで必ず同じ文字列になる
 * （ハイドレーション差異が出ない）。photo_updated_at が無い行でも空文字を
 * 返さない — "?v=" だけが残る URL を作らないため。
 */
export function photoVersion(photoUpdatedAt: string | null | undefined): string {
  const digits = (photoUpdatedAt ?? "").replace(/\D/g, "").slice(0, PHOTO_VERSION_DIGITS);
  return digits === "" ? "0" : digits;
}
