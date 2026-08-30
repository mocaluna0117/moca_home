/**
 * 飼育記録の3テーブルを、ローカルDBの定義そのまま本番へ作成する。
 *
 *   npm run db:push:log            # ローカル（no-op）
 *   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run db:push:log
 *
 * drizzle-kit push はテーブルだけ作ってインデックスを落とすことがあった
 * （実際にローカルで発生し、次回実行時に "no such index" で止まった）。
 * ここは sqlite_master の CREATE 文をそのまま再生するので取りこぼさない。
 * すべて IF NOT EXISTS なので何度実行しても安全。
 */
import { createClient } from "@libsql/client";

const LOG_TABLES = ["meal_entries", "vaccinations", "vaccination_photos"] as const;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} が未設定です`);
  return v;
}

function withIfNotExists(sql: string): string {
  return sql.replace(
    /^CREATE (TABLE|INDEX|UNIQUE INDEX)\s+/i,
    (m) => `${m.trimEnd()} IF NOT EXISTS `,
  );
}

async function main() {
  const localUrl = `file:${process.env.DATABASE_PATH ?? "./data/app.db"}`;
  const targetUrl = requireEnv("TURSO_DATABASE_URL");
  const local = createClient({ url: localUrl });
  const target = targetUrl.startsWith("file:")
    ? createClient({ url: targetUrl })
    : createClient({ url: targetUrl, authToken: requireEnv("TURSO_AUTH_TOKEN") });

  console.log(`定義元: ${localUrl}`);
  console.log(`対象  : ${targetUrl}\n`);

  const placeholders = LOG_TABLES.map(() => "?").join(", ");
  const ddl = await local.execute({
    sql: `select type, name, sql from sqlite_master
          where sql is not null and (name in (${placeholders}) or tbl_name in (${placeholders}))
          order by case type when 'table' then 0 else 1 end`,
    args: [...LOG_TABLES, ...LOG_TABLES],
  });

  if (ddl.rows.length === 0) {
    throw new Error("ローカルDBに飼育記録のテーブルがありません（先に npm run db:push）");
  }

  for (const row of ddl.rows) {
    const name = String(row.name);
    try {
      await target.execute(withIfNotExists(String(row.sql)));
      console.log(`  作成/確認: ${String(row.type).padEnd(5)} ${name}`);
    } catch (err) {
      console.log(`  失敗: ${name} — ${(err as Error).message.slice(0, 70)}`);
    }
  }

  console.log("\n=== 対象DBの状態 ===");
  const after = await target.execute(
    `select type, name from sqlite_master
     where type in ('table','index') and name not like 'sqlite_%'
     order by type, name`,
  );
  const tables = after.rows.filter((r) => r.type === "table").map((r) => String(r.name));
  const indexes = after.rows.filter((r) => r.type === "index").map((r) => String(r.name));
  console.log("  テーブル:", tables.join(", "));
  console.log("  インデックス:", indexes.length, "本");

  const missing = LOG_TABLES.filter((t) => !tables.includes(t));
  local.close();
  target.close();

  if (missing.length > 0) {
    console.error(`\n作成できていないテーブル: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n完了しました。");
}

main().catch((err) => {
  console.error(`失敗: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
