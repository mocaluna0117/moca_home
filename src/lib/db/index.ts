import "server-only";

import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

/**
 * One driver for both environments: libSQL speaks SQLite everywhere.
 * - local  : TURSO_DATABASE_URL=file:./data/app.db (or the DATABASE_PATH default)
 * - Vercel : TURSO_DATABASE_URL=libsql://<db>.turso.io + TURSO_AUTH_TOKEN
 *
 * Serverless filesystems are ephemeral, so a file: URL must never be used in
 * production — we fail loudly rather than silently serving an empty database.
 */
function resolveUrl(): string {
  const explicit = process.env.TURSO_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const filePath = path.resolve(
    /*turbopackIgnore: true*/ process.env.DATABASE_PATH ?? "./data/app.db",
  );
  return `file:${filePath}`;
}

const url = resolveUrl();
const isFileUrl = url.startsWith("file:");

if (isFileUrl && process.env.VERCEL) {
  throw new Error(
    "TURSO_DATABASE_URL が未設定です。Vercel ではファイルDBを使えません（デプロイ環境変数を確認してください）",
  );
}

if (isFileUrl) {
  fs.mkdirSync(path.dirname(url.slice("file:".length)), { recursive: true });
}

// Reuse the connection across dev hot-reloads and warm serverless invocations.
const globalForDb = globalThis as unknown as { __libsql?: Client };

const client =
  globalForDb.__libsql ??
  createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__libsql = client;

export const db = drizzle(client, { schema });
export { schema };
