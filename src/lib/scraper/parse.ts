/**
 * Every CSS selector for the shop lives in this file. If the site's markup
 * changes, this is the only file that needs fixing — the parsers below are
 * pure (html string -> typed object) and are covered by the fail-fast asserts.
 */
import * as cheerio from "cheerio";

import { ParseError } from "./client";

// ---------------------------------------------------------------- primitives

/** "￥3,800" / "3,800円" / "¥0" -> 3800 | 0. Integer yen, never float. */
export function parseYen(text: string | undefined | null): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  if (digits === "") return null;
  return Number.parseInt(digits, 10);
}

/** "￥3,800 × 3" -> { unitPriceYen: 3800, quantity: 3 } */
export function parsePriceQty(text: string): {
  unitPriceYen: number;
  quantity: number;
} {
  const normalized = text.replace(/\s+/g, " ").trim();
  // × is U+00D7; some themes use the ASCII x.
  const parts = normalized.split(/[×x]/);
  const unitPriceYen = parseYen(parts[0]);
  const quantity = parts.length > 1 ? parseYen(parts[1]) : 1;
  if (unitPriceYen === null) {
    throw new ParseError(`SITE_LAYOUT_CHANGED: 単価を読めません: "${normalized}"`);
  }
  return { unitPriceYen, quantity: quantity && quantity > 0 ? quantity : 1 };
}

/**
 * "2026/08/22 8:50:31" (JST, hour not zero-padded) -> "2026-08-22T08:50:31+09:00".
 * Deliberately regex-based: `new Date(string)` would reinterpret this in the
 * host's local timezone.
 */
export function parseJstDate(text: string): string {
  const m = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) {
    throw new ParseError(`SITE_LAYOUT_CHANGED: 日時を読めません: "${text}"`);
  }
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const p = (v: string, n = 2) => v.padStart(n, "0");
  return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}+09:00`;
}

function absolutize(src: string | undefined, origin: string): string | null {
  if (!src) return null;
  if (/^https?:\/\//.test(src)) return src;
  if (src.startsWith("//")) return "https:" + src;
  return origin.replace(/\/$/, "") + (src.startsWith("/") ? src : "/" + src);
}

/** Reads a <dt>label</dt><dd>value</dd> pair from any .ec-definitions* block. */
function definitionValue($: cheerio.CheerioAPI, scope: cheerio.Cheerio<never>, label: string) {
  let found: string | null = null;
  scope.find("dt").each((_, el) => {
    if (found !== null) return;
    const dt = $(el).text().replace(/[\s:：]+/g, "");
    if (dt.includes(label)) {
      found = $(el).nextAll("dd").first().text().trim();
    }
  });
  return found;
}

// ------------------------------------------------------------------ session

export function parseCsrfToken(html: string): string {
  const $ = cheerio.load(html);
  const token = $('input[name="_csrf_token"]').first().attr("value");
  if (!token) {
    throw new ParseError("SITE_LAYOUT_CHANGED: _csrf_token が見つかりません");
  }
  return token;
}

/** True when a response is the login screen (i.e. the session is gone). */
export function isLoginPage(html: string): boolean {
  return (
    html.includes('name="login_pass"') || html.includes('id="login_mypage"')
  );
}

// --------------------------------------------------------------- order list

export interface ParsedListItem {
  productName: string;
  imageUrl: string | null;
  unitPriceYen: number;
  quantity: number;
}

export interface ParsedListOrder {
  id: string;
  orderedAt: string;
  status: string;
  items: ParsedListItem[];
}

export interface ParsedOrderListPage {
  totalCount: number | null;
  lastPage: number;
  orders: ParsedListOrder[];
}

export function parseOrderListPage(
  html: string,
  origin: string,
): ParsedOrderListPage {
  const $ = cheerio.load(html);

  if (isLoginPage(html)) {
    throw new ParseError("SESSION_EXPIRED: 注文履歴ページでログイン画面が返りました");
  }

  const totalCount = parseYen(
    $("p.ec-para-normal")
      .filter((_, el) => /件の履歴/.test($(el).text()))
      .first()
      .text(),
  );

  let lastPage = 1;
  $("ul.ec-pager a").each((_, el) => {
    const m = ($(el).attr("href") ?? "").match(/pageno=(\d+)/);
    if (m) lastPage = Math.max(lastPage, Number.parseInt(m[1], 10));
  });

  const orders: ParsedListOrder[] = [];
  $("div.ec-historyRole__contents").each((_, el) => {
    const block = $(el) as unknown as cheerio.Cheerio<never>;

    const id =
      definitionValue($, block, "ご注文番号") ??
      (block.find('a[href*="/mypage/history/"]').attr("href") ?? "").match(
        /history\/(\d+)/,
      )?.[1] ??
      null;
    const dateText = block.find("p.ec-historyListHeader__date").first().text();
    const status = definitionValue($, block, "ご注文状況");

    if (!id || !dateText.trim()) return;

    const items: ParsedListItem[] = [];
    block.find("div.ec-imageGrid").each((__, itemEl) => {
      const item = $(itemEl);
      const productName = item
        .find("p.ec-historyRole__detailTitle")
        .first()
        .text()
        .trim();
      const priceText = item.find("p.ec-historyRole__detailPrice").first().text();
      if (!productName || !priceText.trim()) return;
      const { unitPriceYen, quantity } = parsePriceQty(priceText);
      items.push({
        productName,
        imageUrl: absolutize(item.find("img").first().attr("src"), origin),
        unitPriceYen,
        quantity,
      });
    });

    orders.push({
      id,
      orderedAt: parseJstDate(dateText),
      status: status ?? "不明",
      items,
    });
  });

  if (orders.length === 0) {
    throw new ParseError(
      "SITE_LAYOUT_CHANGED: 注文履歴ページから注文ブロックを取得できません",
    );
  }

  return { totalCount, lastPage, orders };
}

// ------------------------------------------------------------- order detail

export interface ParsedDetailItem extends ParsedListItem {
  productId: number | null;
}

export interface ParsedOrderDetail {
  id: string;
  orderedAt: string | null;
  status: string | null;
  subtotalYen: number | null;
  feeYen: number | null;
  shippingFeeYen: number | null;
  totalYen: number | null;
  shippingMethod: string | null;
  items: ParsedDetailItem[];
}

export function parseOrderDetail(
  html: string,
  origin: string,
): ParsedOrderDetail {
  const $ = cheerio.load(html);

  if (isLoginPage(html)) {
    throw new ParseError("SESSION_EXPIRED: 注文詳細ページでログイン画面が返りました");
  }

  // The page embeds the full order-confirmation mail, which contains the
  // account holder's address/phone and a duplicate itemization. Drop it before
  // anything else: we neither parse nor store PII.
  $(".ec-orderMail, .ec-orderMail__link").remove();

  const orderScope = $(".ec-orderOrder").first() as unknown as cheerio.Cheerio<never>;
  const id =
    definitionValue($, orderScope, "ご注文番号") ??
    (html.match(/mypage\/history\/(\d+)/)?.[1] ?? "");
  const dateText = definitionValue($, orderScope, "ご注文日時");
  const status = definitionValue($, orderScope, "ご注文状況");

  const items: ParsedDetailItem[] = [];
  $(".ec-orderDelivery__item .ec-imageGrid").each((_, el) => {
    const item = $(el);
    const content = item.find(".ec-imageGrid__content");
    const link = content.find('a[href*="/products/detail/"]').first();
    const productId = (link.attr("href") ?? "").match(/detail\/(\d+)/)?.[1];

    // The product name is the link text when the product still exists;
    // otherwise the first <p> holds the bare name.
    const productName =
      (link.text().trim() ||
        content.find("p").first().text().replace(/[×x]\s*\d+\s*$/, "").trim());

    // The price line is the <p> containing a yen sign.
    const priceText = content
      .find("p")
      .filter((__, p) => /[￥¥]/.test($(p).text()))
      .first()
      .text();

    if (!productName || !priceText.trim()) return;
    const { unitPriceYen, quantity } = parsePriceQty(priceText);
    items.push({
      productId: productId ? Number.parseInt(productId, 10) : null,
      productName,
      imageUrl: absolutize(item.find("img").first().attr("src"), origin),
      unitPriceYen,
      quantity,
    });
  });

  const totalBox = $(".ec-totalBox").first();
  const spec = (label: string) => {
    let value: number | null = null;
    totalBox.find("dl.ec-totalBox__spec").each((_, el) => {
      if (value !== null) return;
      const dt = $(el).find("dt").text().replace(/\s/g, "");
      if (dt.includes(label)) value = parseYen($(el).find("dd").first().text());
    });
    return value;
  };

  const totalYen =
    parseYen(
      totalBox.find(".ec-totalBox__total .ec-totalBox__price").first().text(),
    ) ??
    parseYen(
      totalBox
        .find(".ec-totalBox__paymentTotal .ec-totalBox__price")
        .first()
        .text(),
    );

  // 配送方法 lives in a .ec-definitions--soft block inside the delivery section.
  let shippingMethod: string | null = null;
  $(".ec-orderDelivery .ec-definitions--soft, .ec-definitions--soft").each(
    (_, el) => {
      if (shippingMethod !== null) return;
      const dt = $(el).find("dt").text().replace(/[\s:：]+/g, "");
      if (dt.includes("配送方法")) {
        shippingMethod = $(el).find("dd").first().text().trim() || null;
      }
    },
  );

  if (totalYen === null && items.length === 0) {
    throw new ParseError(
      "SITE_LAYOUT_CHANGED: 注文詳細から合計・明細のいずれも取得できません",
    );
  }

  return {
    id,
    orderedAt: dateText ? parseJstDate(dateText) : null,
    status: status ?? null,
    subtotalYen: spec("小計"),
    feeYen: spec("手数料"),
    shippingFeeYen: spec("送料"),
    totalYen,
    shippingMethod,
    items,
  };
}

// ------------------------------------------------------------- product page

export interface ParsedProduct {
  name: string | null;
  priceYen: number | null;
  descriptionHtml: string | null;
  category: string | null;
  tags: string[];
  imageUrls: string[];
}

export function parseProductPage(html: string, origin: string): ParsedProduct {
  const $ = cheerio.load(html);

  const name = $(".ec-productRole__title h1").first().text().trim() || null;

  const priceYen = parseYen(
    $(".ec-productRole__price .ec-price__price").first().text(),
  );

  const descEl = $(".ec-productRole__description").first();
  // Scraped markup is rendered with dangerouslySetInnerHTML — strip anything
  // executable or layout-breaking here, at the boundary.
  descEl.find("script, style, iframe, object, embed, link, meta").remove();
  descEl.find("*").each((_, el) => {
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    for (const attr of Object.keys(attribs)) {
      if (/^on/i.test(attr)) $(el).removeAttr(attr);
      if (attr === "href" || attr === "src") {
        const v = attribs[attr] ?? "";
        if (/^\s*javascript:/i.test(v)) $(el).removeAttr(attr);
      }
    }
  });
  const descriptionHtml = descEl.length ? (descEl.html() ?? "").trim() || null : null;

  // Each .ec-topicpath is one breadcrumb path; join crumbs with " > " and
  // separate multiple paths with " / ".
  const paths: string[] = [];
  $(".ec-productRole__category .ec-topicpath").each((_, el) => {
    const crumbs = $(el)
      .find("a")
      .map((__, a) => $(a).text().trim())
      .get()
      .filter(Boolean);
    if (crumbs.length) paths.push(crumbs.join(" > "));
  });
  const category = paths.length ? [...new Set(paths)].join(" / ") : null;

  const tags = $(".ec-productRole__tags li")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const imageUrls = [
    ...new Set(
      $(".ec-productRole__visual .ec-productVisualMain img, .ec-productRole__visual .slide-item img")
        .map((_, el) => absolutize($(el).attr("src"), origin))
        .get()
        .filter((u): u is string => Boolean(u)),
    ),
  ];

  return { name, priceYen, descriptionHtml, category, tags, imageUrls };
}
