import type { Config } from "drizzle-kit";

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url:
      process.env.TURSO_DATABASE_URL ??
      `file:${process.env.DATABASE_PATH ?? "./data/app.db"}`,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
