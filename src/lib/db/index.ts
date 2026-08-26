import "server-only";

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

// turbopackIgnore keeps this dynamic path from making the bundler trace the
// whole project into the server output.
const dbPath = path.resolve(
  /*turbopackIgnore: true*/ process.env.DATABASE_PATH ?? "./data/app.db",
);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Reuse the connection across dev hot-reloads (a new handle per reload would
// pile up file locks).
const globalForDb = globalThis as unknown as {
  __sqlite?: Database.Database;
};

const sqlite =
  globalForDb.__sqlite ??
  (() => {
    const conn = new Database(dbPath);
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    return conn;
  })();

if (process.env.NODE_ENV !== "production") globalForDb.__sqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema };
