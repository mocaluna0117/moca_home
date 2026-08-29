/**
 * Copies the local SQLite database into a remote libSQL/Turso database.
 *
 *   TURSO_DATABASE_URL='libsql://…' TURSO_AUTH_TOKEN='…' npm run db:migrate
 *
 * Uses @libsql/client for BOTH ends (it opens `file:` URLs too), so no extra
 * driver and no turso CLI are needed. Safe to re-run: every table is emptied
 * before it is refilled, so a half-finished run self-heals.
 */
import { createClient, type InValue } from "@libsql/client";

const LOCAL_URL = `file:${process.env.DATABASE_PATH ?? "./data/app.db"}`;

/** Parents before children — foreign keys must resolve on insert. */
const TABLES = [
  "orders",
  "products",
  "order_items",
  "sync_runs",
  "received_bonuses",
] as const;

const BATCH = 200;

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} が未設定です`);
  return v;
}

async function main() {
  const remoteUrl = requireEnv("TURSO_DATABASE_URL");
  if (remoteUrl.startsWith("file:")) {
    throw new Error(
      "TURSO_DATABASE_URL がローカルファイルを指しています（libsql://… を指定してください）",
    );
  }

  const local = createClient({ url: LOCAL_URL });
  const remote = createClient({
    url: remoteUrl,
    authToken: requireEnv("TURSO_AUTH_TOKEN"),
  });

  console.log(`ローカル: ${LOCAL_URL}`);
  console.log(`リモート: ${remoteUrl.replace(/\/\/.*@/, "//")}`);

  // 1. Schema — replay the local CREATE statements verbatim.
  const ddl = await local.execute(
    `select type, name, sql from sqlite_master
     where sql is not null and name not like 'sqlite_%'
     order by case type when 'table' then 0 else 1 end`,
  );
  console.log(`\nスキーマを作成中… (${ddl.rows.length} 件)`);
  for (const row of ddl.rows) {
    const sql = String(row.sql);
    const name = String(row.name);
    const create = sql.replace(
      /^CREATE (TABLE|INDEX|UNIQUE INDEX|VIEW|TRIGGER)\s+/i,
      (m) => `${m.trimEnd()} IF NOT EXISTS `,
    );
    try {
      await remote.execute(create);
    } catch (err) {
      console.log(`  スキップ: ${name} (${(err as Error).message.slice(0, 60)})`);
    }
  }

  // 2. Rows — clear then copy, children first so deletes never hit an FK.
  console.log("\n既存データを削除中…");
  for (const table of [...TABLES].reverse()) {
    await remote.execute(`delete from ${table}`).catch(() => {});
  }

  for (const table of TABLES) {
    const src = await local.execute(`select * from ${table}`);
    if (src.rows.length === 0) {
      console.log(`${table}: 0 件`);
      continue;
    }
    const columns = src.columns;
    const placeholders = columns.map(() => "?").join(", ");
    const stmt = `insert into ${table} (${columns.join(", ")}) values (${placeholders})`;

    for (let i = 0; i < src.rows.length; i += BATCH) {
      const slice = src.rows.slice(i, i + BATCH);
      await remote.batch(
        slice.map((row) => ({
          sql: stmt,
          args: columns.map(
            (c) => ((row as Record<string, unknown>)[c] ?? null) as InValue,
          ),
        })),
        "write",
      );
    }
    console.log(`${table}: ${src.rows.length} 件をコピー`);
  }

  // 3. Verify
  console.log("\n=== 件数の照合 ===");
  let mismatch = false;
  for (const table of TABLES) {
    const [l, r] = await Promise.all([
      local.execute(`select count(*) as n from ${table}`),
      remote.execute(`select count(*) as n from ${table}`),
    ]);
    const ln = Number(l.rows[0].n);
    const rn = Number(r.rows[0].n);
    const ok = ln === rn;
    if (!ok) mismatch = true;
    console.log(`  ${table.padEnd(17)} ローカル ${String(ln).padStart(5)} / リモート ${String(rn).padStart(5)}  ${ok ? "OK" : "不一致"}`);
  }

  local.close();
  remote.close();

  if (mismatch) {
    console.error("\n件数が一致しませんでした。もう一度実行してください。");
    process.exitCode = 1;
    return;
  }
  console.log("\n移行が完了しました。");
}

main().catch((err) => {
  console.error(`移行に失敗しました: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
