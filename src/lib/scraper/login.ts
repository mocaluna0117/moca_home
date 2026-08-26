import "server-only";

import { HttpClient, LoginError, type ScraperConfig } from "./client";
import { isLoginPage, parseCsrfToken } from "./parse";

const LOGIN_PATH = "/mypage/login";

/**
 * EC-CUBE login: GET the form for the session cookie + CSRF token, then POST.
 * Success is signalled by a 302 that does NOT point back at the login page.
 */
export async function login(
  client: HttpClient,
  config: Pick<ScraperConfig, "email" | "password">,
): Promise<void> {
  const form = await client.request(LOGIN_PATH);
  if (form.status !== 200) {
    throw new LoginError(`ログインページを取得できません (HTTP ${form.status})`);
  }
  const token = parseCsrfToken(form.body);

  const res = await client.request(LOGIN_PATH, {
    form: {
      login_email: config.email,
      login_pass: config.password,
      _csrf_token: token,
    },
    referer: LOGIN_PATH,
  });

  if (res.status === 302 || res.status === 303) {
    const location = res.location ?? "";
    if (/\/mypage\/login/.test(location)) {
      throw new LoginError(
        "ログインに失敗しました（メールアドレスまたはパスワードを確認してください）",
      );
    }
    if (!client.cookies.has("eccube")) {
      throw new LoginError("ログイン後にセッションCookieを取得できませんでした");
    }
    return;
  }

  // A 200 here means the form was re-rendered, i.e. rejected.
  if (res.status === 200 && isLoginPage(res.body)) {
    throw new LoginError(
      "ログインに失敗しました（メールアドレスまたはパスワードを確認してください）",
    );
  }

  throw new LoginError(`予期しないログイン応答 (HTTP ${res.status})`);
}

/**
 * Runs `fn`; if the shop answers with the login screen mid-scrape, logs in
 * once more and replays it.
 */
export async function withSession<T>(
  client: HttpClient,
  config: Pick<ScraperConfig, "email" | "password">,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("SESSION_EXPIRED")) throw err;
    client.resetSession();
    await login(client, config);
    return await fn();
  }
}
