/**
 * Core product-name extraction from 20&20 marketing titles.
 *
 * The shop buries the actual product name inside 60–140 chars of campaign copy.
 * This module locates the ONE span that is the product line and returns its
 * offsets in the ORIGINAL title, so the UI can bold it in place without
 * removing or reordering a single character.
 *
 * Fail-safe by construction: everything ambiguous returns null and the title
 * renders plain. A wrong bold phrase is worse than no bold phrase.
 *
 * Only import: parseBonusRules from ./bonus (whose matchedText is the exact
 * substring of the title the bonus clause occupies). Pure — usable from server
 * and client components alike, and unit-testable without a DB.
 */
import { parseBonusRules } from "./bonus";

export interface NameHighlight {
  /** UTF-16 index into the ORIGINAL title (inclusive). */
  start: number;
  /** UTF-16 index into the ORIGINAL title (exclusive). */
  end: number;
}

// ------------------------------------------------------------- normalization

/** Same index-preserving 1:1 translation bonus.ts uses — offsets stay valid. */
function normalize(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xff10 && code <= 0xff19) out += String.fromCharCode(code - 0xff10 + 0x30);
    else if (code === 0xff0b) out += "+";
    else if (code === 0xff08) out += "(";
    else if (code === 0xff09) out += ")";
    else if (code === 0x3000) out += " ";
    else out += s[i];
  }
  return out;
}

/** Sentinel written over noise. Not a legal title character. */
const MASK = "\u0001";
/** "Word" chars for clause scanning. MASK is included so a partially masked
 *  clause still scans as one unit. */
const W = "ぁ-ゟァ-ヺー一-鿿A-Za-z0-9\\u0001";
/** Strong segment delimiters — clause masks never cross these. */
const SEG = "♡♪！!？?。『』【】\\n";

function maskRange(s: string, start: number, end: number): string {
  const a = Math.max(0, start);
  const b = Math.min(s.length, end);
  if (b <= a) return s;
  return s.slice(0, a) + MASK.repeat(b - a) + s.slice(b);
}

function maskAll(s: string, patterns: readonly RegExp[]): string {
  let out = s;
  for (const re of patterns) out = out.replace(re, (m) => MASK.repeat(m.length));
  return out;
}

// ------------------------------------------------------------- clause masks
// Run BEFORE the bracket masks: a gift clause legitimately contains parens.

const CLAUSE_RE: readonly RegExp[] = [
  // B-shaped gift clauses parseBonusRules does not cover (no count, nested parens,
  // clause placed at the HEAD of the title).
  new RegExp(`[^${SEG}]{0,24}(?:手作りご飯|非売品ご飯)[^${SEG}]{0,24}プレゼント`, "g"),
  // any 「Nセット/コ/袋ご注文で … プレゼント」 tail
  new RegExp(`\\d+\\s*(?:セット|コ|袋)\\s*(?:ご)?注文\\s*(?:で|のお客様に)[^${SEG}]{0,30}プレゼント`, "g"),
  // guaranteed freebie 「…必ずプレゼント」 (「プレゼン」 typo is real, 1 title)
  new RegExp(`[^${SEG}]{0,30}必ずプレゼン[トﾄ]?`, "g"),
  // companion 「Xと合わせてもOK」「Xと合計3コでもOK」 — extends LEFT past 「、」
  new RegExp(`[^${SEG}]{0,28}と(?:合わせて|合計)[^${SEG}]{0,16}`, "g"),
  // pool scope 「どのXでも」 incl. the chained 「どのXでもYでも」 form
  new RegExp(`どの[${W}]{1,16}(?:でも|も)(?:[${W}]{1,16}(?:でも|も))*`, "g"),
  new RegExp(`どの[${W}]{0,14}?(?:でも|も)?(?=\\s*(?:合計)?\\s*\\d+\\s*(?:コ|セット|袋))`, "g"),
  new RegExp(`または[${W}]{1,16}`, "g"),
  new RegExp(`おまけ[${W}]{0,10}`, "g"),
  // ingredient callout 「〜入り」 — verified never a core across all 74 occurrences
  new RegExp(`[^${SEG}]{0,16}入り`, "g"),
];

// -------------------------------------------------------------- noise masks

const NOISE_RE: readonly RegExp[] = [
  /【[^】]*】/g,
  /\([^)]*\)/g,
  /（[^）]*）/g,
  new RegExp(`発送は[^${SEG}]{0,16}目安`, "g"),
  new RegExp(`[^${SEG}]{0,14}発送目安`, "g"),
  /\d+月\d+日[〜~]?\d*日?\s*発送/g,
  /\d+\s*[gG]\s*増量/g,
  /増量/g,
  /\d+\s*円\s*(?:OFF|off|Off|ＯＦＦ)/g,
  /\d+円割引/g,
  /\d+円分/g,
  /\d{1,2}:\d{2}\s*[〜~]\s*\d{1,2}:\d{2}/g,
  /\d+分限定販売/g,
  /限定販売/g,
  /数量限定/g,
  /本日\d*日?限定/g,
  /\d+袋限定/g,
  /\d+日限定/g,
  /新発売/g, /新登場/g, /新商品/g, /再販/g, /先行ご予約/g, /ご予約商品/g, /特別販売/g,
  /送料無料/g, /賞味期限長め/g,
  /獣医さん[、と]?私?の?おすすめ/g, /獣医さん/g,
  /ブリーダー(?:さん|様)?リクエスト(?:商品)?/g,
  /ブリーダー(?:さん|様)?おすすめ/g,
  /ブリーダー(?:さん|様)?/g,
  /柳原さん/g,
  /^\s*[\\・＊*♡♪]*\s*\d{1,2}月[!！♡♪]?/g,
  /^\s*\d{4}年/g,
  /\d+周年記念[^♡♪！!]{0,12}/g,
  /くじ引き参加/g,
  /おやつ付き/g,
  /おやつ\d*[つコ袋]?同封/g,
  /味比べ\d+コ入り/g,
  /夢中で(?:ぺろり|ペロリ)/g, // adverbial, not the ペロリ product line (2 titles)
  /ご飯のおとも/g,
];

// --------------------------------------------------- product-line dictionary
// Ordered: most specific / most head-like first, FIRST HIT WINS — the same
// convention as productKind() in bonus.ts. Container & dish heads outrank
// ingredient-ish heads (ヤギミルク / チーズ / 乳酸菌), which are last resort.
// Derived by frequency count over 1,120 catalog names + 116 order snapshots.

const FAMILY_RE: readonly RegExp[] = [
  /ふりかけ素/g, /納豆ふりかけ/g, /おかずふりかけ/g, /ふりかけグラノーラ/g,
  /ポタージュふりかけ/g, /ふりかけ/g,
  /ミートローフ/g, /ドックフード/g, /ドッグフード/g, /グラノーラ/g,
  /カジカジ[ぁ-ゟァ-ヺー一-鿿]{1,6}?(?:さん|ちゃん)/g,
  /ペロリ/g, /ぺろり/g, /ポキコ/g,
  /(?:太切り|中切り|細切り|ミニミニ|ミニ)?豚耳さん/g,
  /シラウオ/g, /納豆ちゃん/g, /とさかちゃん/g,
  /フリーズドライ/g, /歯磨きおやつ/g, /ジャーキー/g, /クッキー/g, /ビッツ/g,
  /ボーロ/g, /ラスク/g, /チップス/g, /お煎餅/g, /スクランブルエッグ/g,
  /おやつBOX/g, /おやつボックス/g, /おやつBox/g, /詰め合わせBOX/g, /BOX/g,
  /おやつセット/g, /おやつ便/g, /グルメ便/g, /セット便/g, /詰め合わせ/g,
  /福袋/g, /福の箱/g,
  /ヨーグルトカップ/g, /おかずカップ/g, /ヨーグルト/g,
  /長寿スープ/g, /美容スープ/g, /スープ/g, /ポタージュ/g, /シチュー/g,
  /プレート/g, /おせち/g, /お肉ケーキ/g, /ケーキ/g, /ハンバーグ/g, /ステーキ/g,
  /カップ/g, /スティック/g,
  /手作りご飯/g, /非売品ご飯/g, /ご飯/g, /ごはん/g,
  /雑炊の素/g, /ボウルの素/g, /アサイーボウル/g,
  /(?:エゾ鹿|鹿|馬|牛|豚)タン/g, /アキレス/g, /ナチュラルケア/g, /瞳の煌めき/g,
  /チーズさん/g, /ミンチちゃん/g,
  /甘酒/g, /ヤギミルク/g, /やぎみるく/g, /プロテイン/g, /乳酸菌/g,
  /おやつ/g, /チーズ/g,
];

/** Closed set of real line-modifiers (frequency ≥2 in the corpus, hand-vetted
 *  to exclude ingredient and effect words). Longest match wins. */
const MODIFIERS: readonly string[] = [
  "30種の栄養", "50種の栄養", "10兆個の", "30種の", "50種の",
  "こだわり", "お守り", "美容", "おかず", "有機納豆", "納豆", "和食", "有機",
  "30種", "50種", "10兆個", "特別な", "特別", "濃厚", "特濃", "粉",
  "長寿", "生", "低カロリー", "太切り", "中切り", "細切り", "ミニミニ", "ミニ",
  "ご褒美", "ご馳走", "手作り", "非売品", "お野菜", "ヨーグルト", "ヤギミルク",
  "クリスマス", "お正月", "海鮮", "水切り", "味比べ", "詰め合わせ",
  "巻き巻き", "パラパラ", "鹿肉", "馬肉", "カモ肉",
].sort((a, b) => b.length - a.length);

const LEAD_TRIM = /^[のとはがをにでもやへ+＋&＆・、,]+/;
const BRACKET_RE = /【[^】]*】/g;

// ------------------------------------------------------------------ matching

function firstFamilyHit(s: string): { start: number; end: number } | null {
  for (const re of FAMILY_RE) {
    re.lastIndex = 0;
    for (const m of s.matchAll(re)) {
      if (m[0].includes(MASK) || m.index === undefined) continue;
      return { start: m.index, end: m.index + m[0].length };
    }
  }
  return null;
}

/** Bonus clause spans, via the exact matchedText bonus.ts already records. */
function maskBonusClauses(title: string, s: string): string {
  let out = s;
  for (const rule of parseBonusRules(title)) {
    const at = title.indexOf(rule.matchedText);
    if (at >= 0) out = maskRange(out, at, at + rule.matchedText.length);
  }
  return out;
}

/**
 * The one span of `title` that is the product line, or null.
 * Indexes are into the ORIGINAL string; the caller slices with them.
 */
export function findCoreName(title: string): NameHighlight | null {
  if (!title) return null;

  const base = maskBonusClauses(title, normalize(title));

  // pass 1 — everything outside 【…】
  let scan = maskAll(maskAll(base, CLAUSE_RE), NOISE_RE);
  let hit = firstFamilyHit(scan);

  // pass 2 — demoted zone: 【…】 interiors only. Strictly additive: it runs
  // only when pass 1 found nothing, so it can never override a better hit.
  if (!hit) {
    let inner = MASK.repeat(base.length);
    for (const m of base.matchAll(BRACKET_RE)) {
      if (m.index === undefined) continue;
      inner =
        inner.slice(0, m.index + 1) +
        base.slice(m.index + 1, m.index + m[0].length - 1) +
        inner.slice(m.index + m[0].length - 1);
    }
    scan = maskAll(maskAll(inner, CLAUSE_RE), NOISE_RE);
    hit = firstFamilyHit(scan);
  }
  if (!hit) return null;

  // extend left by the longest whitelisted modifier, mask-free
  let { start } = hit;
  const { end } = hit;
  for (const mod of MODIFIERS) {
    const at = start - mod.length;
    if (at >= 0 && scan.startsWith(mod, at) && !scan.slice(at, start).includes(MASK)) {
      start = at;
      break;
    }
  }

  const trim = LEAD_TRIM.exec(scan.slice(start, end));
  if (trim) start += trim[0].length;
  if (end - start < 2) return null;

  return { start, end };
}

/** Convenience for renderers: [before, core, after]; core === "" when null. */
export function splitCoreName(title: string): [string, string, string] {
  const h = findCoreName(title);
  if (!h) return [title, "", ""];
  return [title.slice(0, h.start), title.slice(h.start, h.end), title.slice(h.end)];
}
