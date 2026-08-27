/**
 * Bonus ("おまけ") extraction from product titles + per-order activation.
 *
 * The shop encodes freebie campaigns inside product names
 * (「2コご注文で＋1コプレゼント」「3セットご注文で手作りご飯プレゼント」…).
 * This module parses those rules from the order_items.product_name snapshots
 * and computes which bonuses an order actually earned, including cross-product
 * pooling (「どのふりかけでも合計3コでOK」).
 *
 * Pure TypeScript, zero imports (no server-only, no DB) — unit-testable.
 * Fail-safe by construction: anything ambiguous under-claims (self pool /
 * no contribution) and at most surfaces a "maybe-poolable" hint.
 */

// ---------------------------------------------------------------- rule types

export type FamilyId =
  | "ふりかけ"
  | "納豆ふりかけ"
  | "ミートローフ"
  | "ドックフード"
  | "グラノーラ"
  | "手作りご飯"
  | "ヤギミルククッキー"
  | "ジャーキー"
  | "おやつ";

export type PoolScope =
  /** 「どのXでも」 — category-wide evidence (also B rules whose subject is 手作りご飯) */
  | { type: "category"; family: FamilyId }
  /** 「(Yと合わせてもOK)」「またはY合計Nコ」 — names a specific companion product */
  | { type: "companion"; family: FamilyId; alias: string };

interface RuleBase {
  /** Exact substring of the ORIGINAL snapshot title (UI tooltip / debug). */
  matchedText: string;
  /** Pooling evidence parsed from this title, or null (=> self pool). */
  scope: PoolScope | null;
}

/** 「＋1コとおやつ6袋プレゼント」「＋カモさんジャーキープレゼント」 */
export interface ExtraGift {
  label: string;
  count: number | null;
  unit: string | null;
}

/** A: same-product bonus 「(合計)Nコご注文で＋Mコプレゼント」 */
export interface SamePlusBonusRule extends RuleBase {
  kind: "same-plus";
  threshold: number;
  /** display only — normalized away for pooling */
  unit: "コ" | "セット" | "袋";
  bonusCount: number;
  extraGifts: ExtraGift[];
}

/** B: different-item gift 「Nセットご注文で手作りご飯(2040円〜)1セットプレゼント」 */
export interface GiftBonusRule extends RuleBase {
  kind: "gift";
  threshold: number;
  unit: "コ" | "セット";
  gift: {
    label: string; // "手作りご飯" | "非売品ご飯"
    count: number; // 1 (default)
    unit: "セット" | null;
    valueYen: number | null; // 2040 | null
    approx: boolean; // true for 「2040円〜」
  };
}

/** C: bonus already included 「3コ＋おまけ1コのお得セット」「3セット＋1コ付き」 */
export interface IncludedBonusRule extends RuleBase {
  kind: "included";
  baseCount: number;
  includedCount: number;
}

export type BonusRule = SamePlusBonusRule | GiftBonusRule | IncludedBonusRule;

// ------------------------------------------------------------- normalization

/**
 * Index-preserving 1:1 char translation ONLY (full-width digits, ＋, （）,
 * ideographic space). Whitespace is NOT collapsed so matchedText can be
 * sliced from the original string at the same UTF-16 indices.
 */
function normalize(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xff10 && code <= 0xff19) out += String.fromCharCode(code - 0xff10 + 0x30);
    else if (code === 0xff0b) out += "+"; // ＋
    else if (code === 0xff08) out += "("; // （
    else if (code === 0xff09) out += ")"; // ）
    else if (code === 0x3000) out += " "; // 全角空白
    else out += s[i];
  }
  return out;
}

// ------------------------------------------------------------------- regexes

// A — the で-clause (で|のお客様に) is REQUIRED: it is what separates A from C
//     and from noise (「涙やけ＋内臓ケア」「3コ＋おまけ1コ」 must not match A).
//     (?:注文で)? after で absorbs the real typo 「3セットご注文で注文で…」.
//     (?:と(.{1,20}?))? captures the compound extra 「＋1コとおやつ6袋プレゼント」.
const A_RE =
  /(?:合計)?(\d+)\s*(コ|セット|袋)(?:の)?(?:\s*(?:ご)?注文)?\s*(?:で|のお客様に)\s*(?:注文で)?\s*\+\s*(\d+)\s*コ(?:の)?\s*(?:と(.{1,20}?))?プレゼント/;

// applied at the offset right after an A match — 「…＋1コプレゼント＋カモさんジャーキープレゼント！」
const A_EXTRA_RE = /^\s*\+\s*(.{1,20}?)プレゼント/;

// B — gift label is a WHITELIST (手作りご飯|非売品ご飯): fail-safe against noise.
//     Optional leading subject (手作りご飯…) marks the 手作りご飯-family B rules.
//     Three optional value slots cover 「(2040円〜)」 before count, bare 「2040円〜」,
//     and the 「1セット (2040円)分」 ordering variant.
const B_RE =
  /(手作りご(?:飯|はん))?\s*(?:合計)?(\d+)\s*(セット|コ)(?:\s*(?:ご)?注文)?\s*(?:で|のお客様に)\s*(?:注文で)?\s*[、,]?\s*\(?\s*(手作りご飯|非売品ご飯)\s*\)?\s*(?:\(\s*(\d{3,5})円\s*〜?\s*\))?\s*(?:(\d{3,5})円〜?)?\s*(?:(\d+)セット)?\s*(?:\(\s*(\d{3,5})円\s*〜?\s*\)\s*分?)?\s*プレゼント/;

// C — three tight shapes, all requiring 「＋」 so 「(100g×3コ入り♡)」 and
//     「お得セット」 alone never match.
const C1_RE = /(\d+)\s*コ(?:セット)?\s*\+\s*おまけ\s*(\d+)\s*コ/; // 3コ＋おまけ1コ / 3コセット＋おまけ1コ入り
const C2_RE = /(\d+)\s*コ入り\s*\+\s*(\d+)\s*おまけ/; // 3コ入り＋1おまけ
const C3_RE = /(\d+)\s*(?:コ|セット)\s*\+\s*(\d+)\s*コ\s*(?:入り|付き)/; // 豪華3コ＋1コ入り / 3セット＋1コ付き

// Pooling-evidence extraction (run on every ruled title, independent of A/B/C).
const SCOPE_RE = /どの(納豆ふりかけ|ふりかけ|ミートローフ|ドックフード|グラノーラ)(?:でも|も)?/;
const COMP_RE =
  /(?:または|\(?\s*(?:どの)?)(30種ふりかけ|10兆個ふりかけ|納豆ふりかけ|帆立納豆ちゃん|有機納豆ちゃん|メロンヤギミルク|若鶏ジャーキー|5周年歯磨きおやつ)(?:と(?:合わせて|合計)|合計)/;

// ---------------------------------------------------------- grouping tables

const COMP_FAMILY: Record<string, FamilyId> = {
  "30種ふりかけ": "ふりかけ",
  "10兆個ふりかけ": "ふりかけ",
  納豆ふりかけ: "納豆ふりかけ",
  帆立納豆ちゃん: "納豆ふりかけ",
  有機納豆ちゃん: "納豆ふりかけ",
  メロンヤギミルク: "ヤギミルククッキー",
  若鶏ジャーキー: "ジャーキー",
  "5周年歯磨きおやつ": "おやつ",
};

/** A companion alias vouches for other items whose NAME matches this pattern. */
const COMP_MEMBER_PAT: Record<string, RegExp | null> = {
  "30種ふりかけ": /30種.*ふりかけ|ふりかけ.*30種/,
  "10兆個ふりかけ": /10兆個/,
  納豆ふりかけ: null, // narrower scope handled via SCOPE_RE (どの納豆ふりかけ)
  帆立納豆ちゃん: /帆立/,
  有機納豆ちゃん: /有機.{0,6}納豆/,
  メロンヤギミルク: /メロン/,
  若鶏ジャーキー: /若鶏.*ジャーキー/,
  "5周年歯磨きおやつ": /歯磨きおやつ/,
};

/** Which product kinds a 「どのXでも」 category pool absorbs (strict, for numbers). */
const FAMILY_KINDS: Record<FamilyId, ReadonlySet<string>> = {
  ふりかけ: new Set(["ふりかけ", "納豆ふりかけ"]),
  納豆ふりかけ: new Set(["納豆ふりかけ"]),
  ミートローフ: new Set(["ミートローフ"]),
  ドックフード: new Set(["ドックフード"]),
  グラノーラ: new Set(["グラノーラ"]),
  手作りご飯: new Set(["手作りご飯", "ごはん"]),
  ヤギミルククッキー: new Set([]),
  ジャーキー: new Set([]),
  おやつ: new Set([]),
};

/** Looser relation used ONLY for the 「合算対象かも」 hint — never affects numbers. */
const HINT_KINDS: Record<FamilyId, ReadonlySet<string>> = {
  ...FAMILY_KINDS,
  ふりかけ: new Set(["ふりかけ", "納豆ふりかけ", "ペロリ"]),
};

/** Bundle products never contribute quantity to a pool. */
const CONTRIB_EXCLUDE = /セット便|おせち|プレート|BOX|ケーキ/;

/** Own-name product kind — most specific first, first hit wins. */
export function productKind(name: string): string | null {
  if (/納豆/.test(name) && /ふりかけ/.test(name)) return "納豆ふりかけ";
  if (/グラノーラ/.test(name)) return "グラノーラ";
  if (/ミートローフ/.test(name)) return "ミートローフ";
  if (/ドックフード|ドッグフード/.test(name)) return "ドックフード";
  if (/ふりかけ/.test(name)) return "ふりかけ";
  if (/10兆個/.test(name)) return "ふりかけ"; // seller's own alias for the 10兆個ふりかけ line
  if (/ペロリ|ぺろり/.test(name)) return "ペロリ";
  if (/クッキー/.test(name)) return "クッキー";
  if (/ジャーキー/.test(name)) return "ジャーキー";
  if (/ヤギミルク/.test(name)) return "ヤギミルク";
  if (/手作りご(?:飯|はん)/.test(name)) return "手作りご飯";
  if (/ご飯|ごはん/.test(name)) return "ごはん";
  return null;
}

// ------------------------------------------------------------------- parsing

const FAMILY_IDS = new Set<string>([
  "ふりかけ",
  "納豆ふりかけ",
  "ミートローフ",
  "ドックフード",
  "グラノーラ",
  "手作りご飯",
  "ヤギミルククッキー",
  "ジャーキー",
  "おやつ",
]);

function parseScope(normalized: string): PoolScope | null {
  const scopeMatch = SCOPE_RE.exec(normalized);
  if (scopeMatch) return { type: "category", family: scopeMatch[1] as FamilyId };
  const compMatch = COMP_RE.exec(normalized);
  if (compMatch) {
    const alias = compMatch[1];
    return { type: "companion", family: COMP_FAMILY[alias], alias };
  }
  return null;
}

function parseExtraGift(raw: string): ExtraGift {
  const m = raw.trim().match(/^(.+?)\s*(\d+)?\s*(袋|コ|個|つ)?$/);
  if (!m) return { label: raw.trim(), count: null, unit: null };
  return {
    label: m[1].trim(),
    count: m[2] ? Number.parseInt(m[2], 10) : null,
    unit: m[3] ?? null,
  };
}

/** All rules found in one title, countable (A/B) first. */
export function parseBonusRules(productName: string): BonusRule[] {
  const n = normalize(productName);
  const rules: BonusRule[] = [];
  const scope = parseScope(n);

  const a = A_RE.exec(n);
  if (a) {
    const extraGifts: ExtraGift[] = [];
    if (a[4]) extraGifts.push(parseExtraGift(a[4]));
    const tail = n.slice(a.index + a[0].length);
    const extra = A_EXTRA_RE.exec(tail);
    if (extra) extraGifts.push(parseExtraGift(extra[1]));
    rules.push({
      kind: "same-plus",
      threshold: Number.parseInt(a[1], 10),
      unit: a[2] as "コ" | "セット" | "袋",
      bonusCount: Number.parseInt(a[3], 10),
      extraGifts,
      matchedText: productName.slice(a.index, a.index + a[0].length),
      scope,
    });
  }

  const b = B_RE.exec(n);
  if (b) {
    const giftCount = b[7] ? Number.parseInt(b[7], 10) : 1;
    const valueYen = b[5] ?? b[6] ?? b[8] ?? null;
    const bScope: PoolScope | null =
      scope ?? (b[1] ? { type: "category", family: "手作りご飯" } : null);
    rules.push({
      kind: "gift",
      threshold: Number.parseInt(b[2], 10),
      unit: b[3] as "セット" | "コ",
      gift: {
        label: b[4],
        count: giftCount,
        unit: b[7] ? "セット" : null,
        valueYen: valueYen ? Number.parseInt(valueYen, 10) : null,
        approx: /円\s*〜/.test(b[0]),
      },
      matchedText: productName.slice(b.index, b.index + b[0].length),
      scope: bScope,
    });
  }

  const c = C1_RE.exec(n) ?? C2_RE.exec(n) ?? C3_RE.exec(n);
  if (c) {
    rules.push({
      kind: "included",
      baseCount: Number.parseInt(c[1], 10),
      includedCount: Number.parseInt(c[2], 10),
      matchedText: productName.slice(c.index, c.index + c[0].length),
      scope: null,
    });
  }

  return rules;
}

/** Primary rule: first countable (A/B), else C, else null. */
export function parseBonusRule(productName: string): BonusRule | null {
  const rules = parseBonusRules(productName);
  return rules.find((r) => r.kind !== "included") ?? rules[0] ?? null;
}

// --------------------------------------------------------------- computation

export interface BonusItemInput {
  productName: string;
  quantity: number;
}

export interface ItemBonusResult {
  /** Primary rule (A/B if present, else C), or null. */
  rule: BonusRule | null;
  /** Freebies from a C rule on this line (includedCount × quantity). */
  includedBonusCount: number;
  /** true when this line's pool contains at least one other line. */
  pooled: boolean;
  poolKey: string | null;
  poolFamily: FamilyId | null;
  /** Pool met its threshold (kind "included": always true). */
  activated: boolean;
  /** The pool's total bonus — repeated on members; sum pools, not items. */
  bonusCount: number;
  giftLabel: string | null;
  hint: "maybe-poolable" | null;
  /** poolKey when this rule-less line contributed quantity to a pool. */
  contributedTo: string | null;
}

export interface PoolResult {
  poolKey: string;
  family: FamilyId | null; // null for self pools
  ruleKind: "same-plus" | "gift";
  threshold: number;
  totalQuantity: number;
  activated: boolean;
  bonusCount: number; // floor(totalQuantity/threshold) × M
  giftLabel: string | null; // B only
  memberIndexes: number[];
  contributorIndexes: number[];
}

export interface OrderGift {
  label: string;
  count: number;
  unit: string | null;
}

export interface OrderBonusResult {
  /** Parallel to the input array. */
  items: ItemBonusResult[];
  pools: PoolResult[];
  /** Same-product freebie units: activated A pools + C included. */
  totalBonusCount: number;
  /** Different-item gifts: B gifts + compound extras, activated only. */
  gifts: OrderGift[];
}

interface Pool {
  key: string;
  family: FamilyId | null;
  ruleKind: "same-plus" | "gift";
  threshold: number;
  payload: string;
  unitBonus: number; // A: bonusCount, B: gift.count
  giftLabel: string | null;
  giftUnit: string | null;
  totalQuantity: number;
  memberIndexes: number[];
  contributorIndexes: number[];
  categoryEvidence: boolean;
  aliases: Set<string>;
}

function payloadOf(rule: SamePlusBonusRule | GiftBonusRule): string {
  return rule.kind === "same-plus" ? `+${rule.bonusCount}` : `gift:${rule.gift.label}`;
}

function poolAccepts(pool: Pool, kind: string | null, name: string): boolean {
  if (pool.categoryEvidence && pool.family && kind && FAMILY_KINDS[pool.family].has(kind)) {
    return true;
  }
  for (const alias of pool.aliases) {
    const pat = COMP_MEMBER_PAT[alias];
    if (pat && pat.test(name)) return true;
  }
  return false;
}

/** Families a kind relates to under the LOOSE hint relation (incl. itself). */
function hintFamilies(kind: string | null): Set<string> {
  const out = new Set<string>();
  if (!kind) return out;
  if (FAMILY_IDS.has(kind)) out.add(kind);
  for (const family of FAMILY_IDS) {
    if (HINT_KINDS[family as FamilyId].has(kind)) out.add(family);
  }
  return out;
}

/**
 * ASSUMPTION: per-every-N semantics — floor(poolQty / threshold) × M.
 * (E.g. 4コ at 「2コで+1」 yields +2 — consistent with real order 9468.)
 */
export function computeOrderBonuses(items: BonusItemInput[]): OrderBonusResult {
  const parsed = items.map((it) => {
    const rules = parseBonusRules(it.productName);
    const countable = rules.find(
      (r): r is SamePlusBonusRule | GiftBonusRule => r.kind !== "included",
    );
    const included = rules.filter((r): r is IncludedBonusRule => r.kind === "included");
    return {
      name: it.productName,
      qty: Math.max(0, it.quantity),
      countable: countable ?? null,
      included,
      kind: productKind(it.productName),
    };
  });

  const pools = new Map<string, Pool>();

  const makePool = (
    key: string,
    family: FamilyId | null,
    rule: SamePlusBonusRule | GiftBonusRule,
  ): Pool => ({
    key,
    family,
    ruleKind: rule.kind,
    threshold: rule.threshold,
    payload: payloadOf(rule),
    unitBonus: rule.kind === "same-plus" ? rule.bonusCount : rule.gift.count,
    giftLabel: rule.kind === "gift" ? rule.gift.label : null,
    giftUnit: rule.kind === "gift" ? rule.gift.unit : null,
    totalQuantity: 0,
    memberIndexes: [],
    contributorIndexes: [],
    categoryEvidence: false,
    aliases: new Set(),
  });

  // Pass 1 — scoped rules open (or join) their family pool.
  parsed.forEach((p, i) => {
    const r = p.countable;
    if (!r || !r.scope) return;
    const key = `${r.scope.family}|${r.kind}|${r.threshold}|${payloadOf(r)}`;
    let pool = pools.get(key);
    if (!pool) {
      pool = makePool(key, r.scope.family, r);
      pools.set(key, pool);
    }
    pool.memberIndexes.push(i);
    pool.totalQuantity += p.qty;
    if (r.scope.type === "category") pool.categoryEvidence = true;
    else pool.aliases.add(r.scope.alias);
  });

  // Pass 2 — unscoped rules are absorbed only on exact-tuple + textual evidence;
  //          0 or 2+ candidates → self pool (under-claim).
  parsed.forEach((p, i) => {
    const r = p.countable;
    if (!r || r.scope) return;
    const payload = payloadOf(r);
    const candidates = [...pools.values()].filter(
      (pool) =>
        pool.family !== null &&
        pool.ruleKind === r.kind &&
        pool.threshold === r.threshold &&
        pool.payload === payload &&
        poolAccepts(pool, p.kind, p.name),
    );
    if (candidates.length === 1) {
      candidates[0].memberIndexes.push(i);
      candidates[0].totalQuantity += p.qty;
    } else {
      const key = `self:${i}`;
      const pool = makePool(key, null, r);
      pool.memberIndexes.push(i);
      pool.totalQuantity = p.qty;
      pools.set(key, pool);
    }
  });

  // Pass 3 — rule-less items contribute quantity to exactly one evident pool;
  //          2+ candidates → contribute to NONE (no double counting).
  const contributedTo: (string | null)[] = parsed.map(() => null);
  const hints: ("maybe-poolable" | null)[] = parsed.map(() => null);
  parsed.forEach((p, i) => {
    if (p.countable || p.included.length > 0) return;
    if (CONTRIB_EXCLUDE.test(p.name)) return;
    const candidates = [...pools.values()].filter(
      (pool) => pool.family !== null && poolAccepts(pool, p.kind, p.name),
    );
    if (candidates.length === 1) {
      candidates[0].contributorIndexes.push(i);
      candidates[0].totalQuantity += p.qty;
      contributedTo[i] = candidates[0].key;
    } else if (candidates.length >= 2) {
      hints[i] = "maybe-poolable";
    }
  });

  // Evaluate pools.
  const poolResults: PoolResult[] = [];
  for (const pool of pools.values()) {
    const factor = Math.floor(pool.totalQuantity / pool.threshold);
    const result: PoolResult = {
      poolKey: pool.key,
      family: pool.family,
      ruleKind: pool.ruleKind,
      threshold: pool.threshold,
      totalQuantity: pool.totalQuantity,
      activated: factor > 0,
      bonusCount: factor * pool.unitBonus,
      giftLabel: pool.giftLabel,
      memberIndexes: pool.memberIndexes,
      contributorIndexes: pool.contributorIndexes,
    };
    poolResults.push(result);
  }

  // Assemble per-item results.
  const results: ItemBonusResult[] = parsed.map((p, i) => {
    const includedBonusCount = p.included.reduce((n, c) => n + c.includedCount * p.qty, 0);
    const rule: BonusRule | null = p.countable ?? p.included[0] ?? null;
    return {
      rule,
      includedBonusCount,
      pooled: false,
      poolKey: null,
      poolFamily: null,
      activated: includedBonusCount > 0,
      bonusCount: includedBonusCount,
      giftLabel: null,
      hint: hints[i],
      contributedTo: contributedTo[i],
    };
  });

  for (const pool of poolResults) {
    const participants = pool.memberIndexes.length + pool.contributorIndexes.length;
    for (const i of [...pool.memberIndexes, ...pool.contributorIndexes]) {
      const r = results[i];
      r.pooled = participants > 1;
      r.poolKey = pool.poolKey;
      r.poolFamily = pool.family;
      r.activated = r.activated || pool.activated;
      r.bonusCount = pool.activated ? pool.bonusCount + r.includedBonusCount : r.includedBonusCount;
      r.giftLabel = pool.giftLabel;
    }
  }

  // Hints for ruled-but-stranded items: another UNACTIVATED, differently-pooled
  // item whose kind relates under the loose hint relation.
  const rel = parsed.map((p) => hintFamilies(p.kind));
  parsed.forEach((p, i) => {
    if (!p.countable || results[i].activated || results[i].hint) return;
    for (let j = 0; j < parsed.length; j++) {
      if (j === i || results[j].activated) continue;
      if (results[j].poolKey !== null && results[j].poolKey === results[i].poolKey) continue;
      if (!parsed[j].countable && contributedTo[j] === null && parsed[j].included.length === 0) {
        continue; // unruled non-contributors don't imply a missed pool
      }
      const shared = [...rel[i]].some((f) => rel[j].has(f));
      if (shared) {
        results[i].hint = "maybe-poolable";
        break;
      }
    }
  });

  // Order-level totals.
  let totalBonusCount = 0;
  const gifts: OrderGift[] = [];
  for (const pool of poolResults) {
    if (!pool.activated) continue;
    if (pool.ruleKind === "same-plus") {
      totalBonusCount += pool.bonusCount;
      // Compound extras attached to member rules multiply by the same factor.
      const factor = Math.floor(pool.totalQuantity / pool.threshold);
      for (const i of pool.memberIndexes) {
        const r = parsed[i].countable;
        if (r?.kind !== "same-plus") continue;
        for (const extra of r.extraGifts) {
          gifts.push({
            label: extra.label,
            count: (extra.count ?? 1) * factor,
            unit: extra.unit,
          });
        }
      }
    } else {
      gifts.push({
        label: pool.giftLabel ?? "プレゼント",
        count: pool.bonusCount,
        unit: pools.get(pool.poolKey)?.giftUnit ?? null,
      });
    }
  }
  for (const r of results) totalBonusCount += r.includedBonusCount;

  return { items: results, pools: poolResults, totalBonusCount, gifts };
}

// -------------------------------------------------- received-bonus drafting

export interface ReceivedBonusDraft {
  productId: number | null;
  label: string;
  quantity: number;
  source: "pool" | "gift" | "included";
}

/**
 * Maps an order's PREDICTED bonuses onto draft rows for the manual
 * 「届いたおまけ」 form (the 予測を取り込む button). Same parallel-array
 * convention as computeOrderBonuses; `items` must be the array that
 * produced `bonuses`.
 *
 * - Activated A pools → one row per pool; the product is the first member
 *   with a productId (which member the shop actually ships is ambiguous for
 *   multi-member pools — a deliberate under-commitment the user edits).
 * - gifts (B gifts + compound extras) → label-only rows. Deliberately NO
 *   catalog matching: 手作りご飯-style labels match many catalog rows and
 *   the delivered flavor is unknowable — a wrong prefill is worse than a
 *   blank picker.
 * - C included → the product itself.
 */
export function draftReceivedBonuses(
  items: ReadonlyArray<{ productName: string; productId?: number | null }>,
  bonuses: OrderBonusResult,
): ReceivedBonusDraft[] {
  const drafts: ReceivedBonusDraft[] = [];

  for (const pool of bonuses.pools) {
    if (!pool.activated || pool.ruleKind !== "same-plus" || pool.bonusCount <= 0) {
      continue;
    }
    const memberIndex =
      pool.memberIndexes.find((i) => items[i]?.productId != null) ??
      pool.memberIndexes[0];
    const member = memberIndex !== undefined ? items[memberIndex] : undefined;
    if (!member) continue;
    drafts.push({
      productId: member.productId ?? null,
      label: member.productName,
      quantity: pool.bonusCount,
      source: "pool",
    });
  }

  for (const gift of bonuses.gifts) {
    drafts.push({
      productId: null,
      label: gift.label,
      quantity: gift.count,
      source: "gift",
    });
  }

  bonuses.items.forEach((r, i) => {
    if (r.includedBonusCount <= 0) return;
    const item = items[i];
    if (!item) return;
    drafts.push({
      productId: item.productId ?? null,
      label: item.productName,
      quantity: r.includedBonusCount,
      source: "included",
    });
  });

  return drafts;
}
