import "server-only";

export class ScraperError extends Error {}
export class LoginError extends ScraperError {}
export class ParseError extends ScraperError {}
export class NotFoundError extends ScraperError {}

export interface ScraperConfig {
  baseUrl: string;
  email: string;
  password: string;
  delayMs: number;
}

export function loadConfig(): ScraperConfig {
  const baseUrl = process.env.ECCUBE_BASE_URL ?? "https://20and20.pet/store";
  const email = process.env.ECCUBE_LOGIN_EMAIL;
  const password = process.env.ECCUBE_LOGIN_PASSWORD;
  if (!email || !password) {
    // Never echo values — only names.
    throw new ScraperError(
      "ECCUBE_LOGIN_EMAIL / ECCUBE_LOGIN_PASSWORD が未設定です (.env.local を確認してください)",
    );
  }
  const delayMs = Number(process.env.SCRAPER_DELAY_MS ?? 1000);
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    email,
    password,
    delayMs: Number.isFinite(delayMs) ? delayMs : 1000,
  };
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Minimal cookie jar. The shop sets exactly one cookie we care about
 * (`eccube`, the session), so name=value tracking is enough — no domain/path
 * matching, no expiry handling.
 */
class CookieJar {
  private jar = new Map<string, string>();

  absorb(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      // A deleted cookie (empty value) should drop, not linger.
      if (value === "" || value === "deleted") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  header(): string {
    return [...this.jar]. map(([k, v]) => `${k}=${v}`).join("; ");
  }

  has(name: string) {
    return this.jar.has(name);
  }

  clear() {
    this.jar.clear();
  }
}

export interface FetchResult {
  status: number;
  location: string | null;
  body: string;
  url: string;
}

export class HttpClient {
  readonly cookies = new CookieJar();
  private lastRequestAt = 0;

  constructor(private readonly config: ScraperConfig) {}

  get baseUrl() {
    return this.config.baseUrl;
  }

  /** Absolute URL for a shop-relative path, e.g. "/mypage/" or "/store/foo". */
  resolve(pathOrUrl: string): string {
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
    const origin = new URL(this.config.baseUrl).origin;
    if (pathOrUrl.startsWith("/store/")) return origin + pathOrUrl;
    return this.config.baseUrl + (pathOrUrl.startsWith("/") ? "" : "/") + pathOrUrl;
  }

  private async throttle() {
    const wait = this.config.delayMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  /** One request. Redirects are NOT followed — the login 302 is a signal. */
  async request(
    pathOrUrl: string,
    init: { method?: string; form?: Record<string, string>; referer?: string } = {},
  ): Promise<FetchResult> {
    const url = this.resolve(pathOrUrl);
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Accept-Language": "ja,en;q=0.8",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    const cookie = this.cookies.header();
    if (cookie) headers.Cookie = cookie;
    if (init.referer) headers.Referer = this.resolve(init.referer);

    let body: string | undefined;
    if (init.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(init.form).toString();
    }

    const method = init.method ?? (init.form ? "POST" : "GET");

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2000);
      await this.throttle();
      try {
        const res = await fetch(url, {
          method,
          headers,
          body,
          redirect: "manual",
          cache: "no-store",
        });
        this.cookies.absorb(res);
        // Retry server errors once; 4xx are caller-meaningful (404 etc).
        if (res.status >= 500) {
          lastError = new ScraperError(`HTTP ${res.status} for ${url}`);
          await res.text().catch(() => "");
          continue;
        }
        return {
          status: res.status,
          location: res.headers.get("location"),
          body: res.status === 204 ? "" : await res.text(),
          url,
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw new ScraperError(
      `リクエスト失敗: ${url} — ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  resetSession() {
    this.cookies.clear();
  }
}
