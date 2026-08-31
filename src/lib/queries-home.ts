import "server-only";

import type { DayDraft } from "@/components/calendar/meal-day-dialog";
import type { MedicineOption } from "@/components/care/medicine-select";
import { isBlobConfigured } from "@/lib/blob";
import {
  MEAL_SLOTS,
  SLOT_LABEL,
  diffDays,
  todayJst,
  type DateStr,
  type MealSlot,
} from "@/lib/calendar";
import type { DogProfile } from "@/lib/db/schema";
import { nowJstIso } from "@/lib/format";
import {
  buildHomeSchedule,
  type ScheduleRow,
  type UrgentItem,
} from "@/lib/home";
import {
  DEFAULT_DOG_NAME,
  SEX_LABEL,
  ageLabel,
  formatWeight,
  photoVersion,
  todayHighlight,
  type TodayHighlight,
} from "@/lib/profile";
import { getLastSync, getStats } from "@/lib/queries";
import {
  getHeartwormDoses,
  getHeartwormMedicines,
  getRecentCareDates,
} from "@/lib/queries-care";
import {
  getRecentMealDays,
  getVaccinationSchedule,
  type DayMeals,
  type MealEntryRow,
} from "@/lib/queries-log";
import { getDogProfile } from "@/lib/queries-profile";
import { shortLabel } from "@/lib/short-name";

/**
 * ホーム（/）が要るものを**1回のまとまり**にする層。
 *
 * ここに導出を集めるのは、ホームが5つの性格の違うブロックを積むページで、
 * 各ブロックが自分でクエリと判定を持つと「今日」の定義や「前回」の定義が
 * ブロックごとに増えるため。コンポーネントは受け取ったものを描くだけ、
 * 判定は純関数（src/lib/home.ts / src/lib/profile.ts）、往復はここ。
 *
 * クエリは9文（プロフィール1・ごはん2・フィラリア1・薬1・ワクチン1・
 * トリミング1・集計1・同期1）。加えて layout.tsx が認証済みリクエストごとに
 * 4文走らせるので、着地1回で計13文。Turso は1文ごとに往復が乗るので、
 * 遅ければ次の手は (a) layout の getCatalogState を1文にまとめる、
 * (b) ヒーロー以外を <Suspense> で分割、の順。**Suspense 分割は最初から
 * やらない** — 境界4つのスケルトンのちらつきのほうが高くつく。
 */

/** ヒーローの「今日のごはん」1行、「最近のごはん」1日の中の1行。 */
export interface HomeMealLine {
  slot: MealSlot;
  /** 「朝」「夜」「おやつ」 */
  label: string;
  /** 「ペロリ、ミートローフ」。未記録なら下記の代替文 */
  text: string;
  /** 未記録の行。描く側は muted にするだけ */
  empty: boolean;
}

export interface HomeRecentDay {
  date: DateStr;
  /** 「きのう」。2日以上前は null（相対表記を出さない） */
  relative: string | null;
  /** **記録のあるスロットだけ**。記録が無い日はそもそもこの配列に入らない */
  lines: HomeMealLine[];
}

/**
 * ヒーローに渡す一式。`<MocaHero {...home.hero} />` で全部渡る。
 *
 * 文字列はすべて出来上がった状態で入っている（年齢・記念日・体重の
 * 導出は src/lib/profile.ts、ここはその戻りを詰めるだけ）。
 * ヒーロー側に残る整形は formatDayLabel(today) とアイコンの選択だけ。
 */
export interface HomeHero {
  today: DateStr;
  /** 行が無いときは DEFAULT_DOG_NAME。**「名前未設定」とは書かない** */
  name: string;
  /** 「トイプードル ・ 女の子 ・ 4歳2か月」。1つも無ければ null（行ごと出さない） */
  meta: string | null;
  /** 今日の一言。**必ず高々1つ**（優先順は todayHighlight が決めきる） */
  highlight: TodayHighlight | null;
  /** ひとこと。空なら null */
  note: string | null;
  /** 「5.2kg（6月1日に測定）」。測定日が無ければ「5.2kg」、体重が無ければ null */
  weight: string | null;
  /** **常に3行**（朝・夜・おやつ）。形が先に見えるので何を入れる場所か分かる */
  mealLines: HomeMealLine[];
  /** 「今日を記録」の MealDayDialog に渡す下書き */
  todayDraft: DayDraft;
  /** 「前回をコピー」の対象。今日より前で記録のある直近の日 */
  previousDate: DateStr | null;
  /**
   * ProfileFrame / ProfileDialog の初期値。行が無ければ null。
   *
   * 行を丸ごと client に渡す（写真の pathname も乗る）。private ストアの
   * pathname は単体では何も開けず、vaccination-dialog も同じものを渡して
   * いる。ダイアログが「写真を消す」を出すかどうかをこれで決められる。
   */
  profile: DogProfile | null;
  /** 丸写真の src。写真が無い / Blob 未設定なら null */
  photoSrc: string | null;
  blobEnabled: boolean;
}

export interface HomeSnapshot {
  today: DateStr;
  /** 空配列なら緊急バンドを描かない（平常日は DOM に無い） */
  urgent: UrgentItem[];
  /** 常に3件・順序固定（フィラリア → ワクチン → トリミング） */
  scheduleRows: ScheduleRow[];
  /** **今日は含まない**（今日はヒーローが持つ）。新しい順に最大3日 */
  recentDays: HomeRecentDay[];
  todayDraft: DayDraft;
  previousDate: DateStr | null;
  /** 「次の予定」と「最近のごはん」を1枚の【はじめかた】に畳むか */
  showGettingStarted: boolean;
  hero: HomeHero;
  stats: Awaited<ReturnType<typeof getStats>>;
  /** sync_runs.finished_at。formatSyncedAt に渡す生の ISO */
  lastSyncedAt: string | null;
  /** 緊急バンドの HeartwormRecordDialog の必須 prop */
  medicines: MedicineOption[];
  blobEnabled: boolean;
}

/**
 * ごはんを引く日数。今日に記録があれば [今日, -1, -2, -3] で
 * 「今日 + 最近の3日」がちょうど揃い、今日が未記録なら前4日から3日を使う。
 */
const MEAL_DAYS = 4;

/**
 * 未記録のスロットに出す文字。**朝と夜だけ「まだ」と言う。**
 * おやつは無い日が普通なので、催促の形にしない（「—」）。
 */
const EMPTY_SLOT_TEXT: Record<MealSlot, string> = {
  morning: "まだ",
  evening: "まだ",
  treat: "—",
};

/** 商品名の表示上限。MonthAgendaView の1行と同じ 16 に揃える */
const MEAL_LABEL_MAX = 16;

/** 空の部分を落として ・ で繋ぐ。犬種が未登録でも「 ・ 」が浮かない */
function joinMeta(parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((p): p is string => typeof p === "string" && p !== "");
  return kept.length === 0 ? null : kept.join(" ・ ");
}

function mealLine(slot: MealSlot, entries: MealEntryRow[]): HomeMealLine {
  return {
    slot,
    label: SLOT_LABEL[slot],
    text:
      entries.length === 0
        ? EMPTY_SLOT_TEXT[slot]
        : entries.map((e) => shortLabel(e.label, MEAL_LABEL_MAX)).join("、"),
    empty: entries.length === 0,
  };
}

/**
 * DB 行をダイアログの入力の形に落とす。
 *
 * MealEntryRow をそのまま渡さないのは、client に渡る payload を
 * ダイアログが使う列だけにするため。同じ写しが app/calendar/page.tsx にも
 * ある（共有するなら DayDraft の隣が正しい場所だが、あの2箇所を1つに
 * するのは今回の範囲外）。
 */
function toDraft(date: DateStr, meals: DayMeals | null): DayDraft {
  const rows = (entries: MealEntryRow[]) =>
    entries.map((r) => ({
      id: r.id,
      productId: r.productId,
      label: r.label,
      amount: r.amount,
      note: r.note,
      imageUrl: r.imageUrl,
    }));
  return {
    date,
    morning: meals ? rows(meals.morning) : [],
    evening: meals ? rows(meals.evening) : [],
    treat: meals ? rows(meals.treat) : [],
  };
}

export async function getHomeSnapshot(): Promise<HomeSnapshot> {
  const today = todayJst(nowJstIso());

  const [profile, mealDays, doses, medicines, vaccineSchedule, trimmingDates, stats, lastSync] =
    await Promise.all([
      getDogProfile(),
      getRecentMealDays(MEAL_DAYS),
      getHeartwormDoses(),
      // HeartwormRecordDialog の必須 prop。バンドに「飲ませた」を埋めるので
      // 予定が無い日でも引く（1文・高々十数行）
      getHeartwormMedicines(),
      getVaccinationSchedule(),
      getRecentCareDates("trimming", MEAL_DAYS),
      getStats(),
      getLastSync(),
    ]);

  // 1本のクエリの戻りを3つの用途に分ける（「前回」の真実を1つにする）
  const todayMeals = mealDays[0]?.date === today ? mealDays[0] : null;
  const pastDays = mealDays.filter((d) => d.date < today);
  const previousDate = pastDays[0]?.date ?? null;

  const { urgent, rows } = buildHomeSchedule(
    { doses, vaccineSchedule, trimmingDates },
    today,
  );

  const recentDays: HomeRecentDay[] = pastDays.slice(0, 3).map((d) => ({
    date: d.date,
    // 「2日前」までは言わない。日付だけで足りるし、日付が2つの表記を持つと読みにくい
    relative: diffDays(d.date, today) === 1 ? "きのう" : null,
    lines: MEAL_SLOTS.filter((slot) => d[slot].length > 0).map((slot) =>
      mealLine(slot, d[slot]),
    ),
  }));

  const todayDraft = toDraft(today, todayMeals);
  const blobEnabled = isBlobConfigured();

  const hero: HomeHero = {
    today,
    name: profile?.name.trim() || DEFAULT_DOG_NAME,
    meta: joinMeta([
      profile?.breed?.trim(),
      profile?.sex ? SEX_LABEL[profile.sex] : null,
      // 年齢は誕生日から毎回計算する（列に持つと必ず古くなる）
      ageLabel(profile?.birthday, today),
    ]),
    highlight: profile === null ? null : todayHighlight(profile, today),
    note: profile?.note?.trim() || null,
    weight: formatWeight(profile?.weightGrams, profile?.weighedOn),
    mealLines: MEAL_SLOTS.map((slot) => mealLine(slot, todayMeals?.[slot] ?? [])),
    todayDraft,
    previousDate,
    profile,
    // Blob 未設定のときは src を作らない。/api/dog-photo も 404 を返すので、
    // 作れば必ず onError の破線に落ちる往復が1つ増えるだけ。
    // ?v= は差し替え後に古い写真が残らないためのキャッシュ破り。
    photoSrc:
      blobEnabled && profile?.photoPathname
        ? `/api/dog-photo?v=${photoVersion(profile.photoUpdatedAt)}`
        : null,
    blobEnabled,
  };

  return {
    today,
    urgent,
    scheduleRows: rows,
    recentDays,
    // hero にも同じ値が入っている（MocaHero へ {...hero} で渡すため）。
    // 導出は上の1回だけで、参照も同じもの — 真実が2つになる余地は無い。
    todayDraft,
    previousDate,
    /**
     * 3種すべて未設定で、ごはんの記録が今日も過去も無い = まだ何も
     * 始まっていない状態。同じ寸法の破線ボックスを2つ並べる代わりに
     * 【はじめかた】1枚に畳む。
     */
    showGettingStarted:
      rows.every((r) => r.state === "unset") &&
      recentDays.length === 0 &&
      todayMeals === null,
    hero,
    stats,
    lastSyncedAt: lastSync?.finishedAt ?? null,
    medicines,
    blobEnabled,
  };
}
