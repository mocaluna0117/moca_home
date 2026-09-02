/**
 * アプリ独自のテーブル（飼育記録・お気に入り）を、ローカルDBの定義そのまま
 * 対象DBへ作成する。
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

const PUSH_TABLES = [
  "meal_entries",
  // 忘れると本番だけ /calendar が no such table: usual_meals で 500 になる
  // （getDogProfile() のような try/catch の受け皿がこの経路には無い）。
  "usual_meals",
  "vaccinations",
  "vaccination_photos",
  "product_favorites",
  "care_visits",
  "care_visit_items",
  "heartworm_doses",
  "medicines",
  // これを忘れると本番だけ実行時に no such table: dog_profile になる。
  // / がサイトの入口なので、1テーブルの取りこぼしで全ページに到達できなくなる
  // （最後の受け皿は getDogProfile() の try/catch → null）。
  "dog_profile",
] as const;

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

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

async function columnsOf(
  client: ReturnType<typeof createClient>,
  table: string,
): Promise<ColumnInfo[]> {
  try {
    const r = await client.execute(`pragma table_info(${table})`);
    return r.rows.map((row) => ({
      name: String(row.name),
      type: String(row.type ?? ""),
      notnull: Number(row.notnull ?? 0),
      dflt_value: row.dflt_value === null ? null : String(row.dflt_value),
    }));
  } catch {
    return [];
  }
}

/**
 * CREATE TABLE IF NOT EXISTS では、**すでにあるテーブルに列は増えない**。
 * 列を1本足しただけの変更が本番に届かず、実行時に "no such column" で
 * 初めて気づく、という壊れ方をする。ここで差分を見て ALTER する。
 */
async function syncColumns(
  local: ReturnType<typeof createClient>,
  target: ReturnType<typeof createClient>,
  table: string,
): Promise<void> {
  const want = await columnsOf(local, table);
  const have = new Set((await columnsOf(target, table)).map((c) => c.name));
  if (want.length === 0 || have.size === 0) return;

  for (const col of want) {
    if (have.has(col.name)) continue;
    // SQLite は既定値の無い NOT NULL 列を後から足せない
    if (col.notnull === 1 && col.dflt_value === null) {
      console.log(
        `  要手動: ${table}.${col.name} は NOT NULL で既定値が無く、ALTER で足せません`,
      );
      continue;
    }
    const parts = [`alter table ${table} add column ${col.name} ${col.type}`.trim()];
    if (col.dflt_value !== null) parts.push(`default ${col.dflt_value}`);
    if (col.notnull === 1) parts.push("not null");
    try {
      await target.execute(parts.join(" "));
      console.log(`  列を追加: ${table}.${col.name}`);
    } catch (err) {
      console.log(`  列の追加に失敗: ${table}.${col.name} — ${(err as Error).message.slice(0, 60)}`);
    }
  }
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

  const placeholders = PUSH_TABLES.map(() => "?").join(", ");
  const ddl = await local.execute({
    sql: `select type, name, sql from sqlite_master
          where sql is not null and (name in (${placeholders}) or tbl_name in (${placeholders}))
          order by case type when 'table' then 0 else 1 end`,
    args: [...PUSH_TABLES, ...PUSH_TABLES],
  });

  if (ddl.rows.length === 0) {
    throw new Error("ローカルDBに対象テーブルがありません（先に npm run db:push）");
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

  // 既存テーブルに増えた列を送る（CREATE IF NOT EXISTS では届かない）
  for (const table of PUSH_TABLES) {
    await syncColumns(local, target, table);
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

  const missing = PUSH_TABLES.filter((t) => !tables.includes(t));
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
