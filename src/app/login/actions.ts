"use server";

import { cookies } from "next/headers";

import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  appPassword,
  createSessionValue,
  passwordMatches,
} from "@/lib/auth";

export async function login(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  if (!appPassword()) {
    return { error: "サーバー側でパスワードが設定されていません" };
  }
  const password = String(formData.get("password") ?? "");
  if (!passwordMatches(password)) {
    return { error: "パスワードが違います" };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
