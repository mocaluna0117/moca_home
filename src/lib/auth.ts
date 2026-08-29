import "server-only";

/**
 * Single-user gate. There is no user table: one password in an env var, and a
 * signed httpOnly cookie proving it was entered. Uses Web Crypto only, so the
 * same code runs in middleware (edge) and in route handlers (node).
 */
export const SESSION_COOKIE = "20and20_session";

/** 30 days — this is a personal tool, not a bank. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET が未設定です（32文字以上のランダム文字列を設定してください）");
  }
  return s;
}

export function appPassword(): string | null {
  const p = process.env.APP_PASSWORD;
  return p && p.length > 0 ? p : null;
}

const encoder = new TextEncoder();

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time compare — avoids leaking how much of a value matched. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Cookie value = "<issuedAtMs>.<hmac>" — self-contained, no server session. */
export async function createSessionValue(): Promise<string> {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${await hmac(issuedAt)}`;
}

export async function isValidSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return false;
  const issuedAt = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_MAX_AGE * 1000) return false;
  return timingSafeEqual(sig, await hmac(issuedAt));
}

export function passwordMatches(input: string): boolean {
  const expected = appPassword();
  if (!expected) return false;
  return timingSafeEqual(input, expected);
}
