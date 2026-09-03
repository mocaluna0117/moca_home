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
 *
 * 届けられる変更は3種類（順に実行する）:
 *   1. 新しいテーブル            — CREATE TABLE IF NOT EXISTS
 *   2. 既存テーブルへの列の追加  — ALTER TABLE ADD COLUMN（syncColumns）
 *   3. 既存の列の NOT NULL 外し  — テーブルの作り直し（rebuildIfLoosened）
 *   最後にインデックスを CREATE INDEX IF NOT EXISTS。
 */
import { createClient, type Client } from "@libsql/client";

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
  // いつも行くお店・病院とトリミングのコース。忘れると本番だけ /care が
  // no such table: care_places で 500 になる
  "care_places",
  "care_courses",
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

async function columnsOf(client: Client, table: string): Promise<ColumnInfo[]> {
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
async function syncColumns(local: Client, target: Client, table: string): Promise<void> {
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

/** このテーブルを外部キーで参照している他のテーブル（親なら作り直さない） */
async function referencedBy(client: Client, table: string): Promise<string[]> {
  const tables = await client.execute(
    `select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`,
  );
  const refs: string[] = [];
  for (const row of tables.rows) {
    const name = String(row.name);
    if (name === table) continue;
    const fks = await client.execute(`pragma foreign_key_list(${name})`);
    if (fks.rows.some((fk) => String(fk.table) === table)) refs.push(name);
  }
  return refs;
}

/** CREATE TABLE "care_visit_items" (…) の名前だけを差し替える */
function renameInCreate(sql: string, from: string, to: string): string | null {
  const re = /^(CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`[]?)([A-Za-z0-9_]+)(["`\]]?)/i;
  const m = re.exec(sql);
  if (!m || m[2] !== from) return null;
  return sql.replace(re, `$1${to}$3`);
}

/**
 * ローカルで **NOT NULL を外した列**を届ける（例: care_visit_items.amount_yen —
 * トリミングは予約の時点で記録するので金額が空欄になった）。
 *
 * SQLite は ALTER TABLE で列の制約を変えられないので、テーブルを作り直す:
 * 新しい定義で __new を作る → 行を写す → 古いのを消す → 改名 → インデックスを
 * 作り直す。1つのトランザクション（batch）で行うので、途中で切れても
 * 古いテーブルがそのまま残る。
 *
 * 守り:
 * - **他のテーブルから外部キーで参照されているテーブルは触らない**（要手動）。
 *   親を DROP すると foreign_keys=ON の環境で子の行が連鎖削除される。
 *   care_visit_items は子（care_visits を参照する側）なので通る
 * - 写すのは両方にある列だけ。足りない列は syncColumns が先に足しているので、
 *   実際には全列がそろう
 * - 前後の行数を比べ、違えば終了コードを 1 にする
 */
async function rebuildIfLoosened(
  local: Client,
  target: Client,
  table: string,
  createSql: string,
  indexSqls: string[],
): Promise<void> {
  const want = await columnsOf(local, table);
  const have = await columnsOf(target, table);
  if (want.length === 0 || have.length === 0) return;
  const haveByName = new Map(have.map((c) => [c.name, c]));

  const loosened = want.filter((c) => {
    const h = haveByName.get(c.name);
    return h !== undefined && h.notnull === 1 && c.notnull === 0;
  });
  if (loosened.length === 0) return;
  const names = loosened.map((c) => c.name).join(", ");

  const refs = await referencedBy(target, table);
  if (refs.length > 0) {
    console.log(
      `  要手動: ${table} の NOT NULL を外す（${names}）には作り直しが要りますが、` +
        `${refs.join(", ")} から参照されているので自動では行いません`,
    );
    return;
  }
  const tmp = `${table}__new`;
  const createTmp = renameInCreate(createSql, table, tmp);
  if (createTmp === null) {
    console.log(`  要手動: ${table} の CREATE 文からテーブル名を読めませんでした`);
    return;
  }
  const cols = want
    .map((c) => c.name)
    .filter((n) => haveByName.has(n))
    .join(", ");

  const count = async () =>
    Number((await target.execute(`select count(*) as n from ${table}`)).rows[0]?.n ?? 0);
  const before = await count();
  try {
    await target.batch(
      [
        `drop table if exists ${tmp}`,
        createTmp,
        `insert into ${tmp} (${cols}) select ${cols} from ${table}`,
        `drop table ${table}`,
        `alter table ${tmp} rename to ${table}`,
        ...indexSqls.map(withIfNotExists),
      ],
      "write",
    );
  } catch (err) {
    console.log(`  作り直しに失敗: ${table} — ${(err as Error).message.slice(0, 80)}`);
    process.exitCode = 1;
    return;
  }
  const after = await count();
  console.log(`  作り直し: ${table}（NOT NULL を外した列: ${names}）${before}行 → ${after}行`);
  if (before !== after) {
    console.error(`  行数が一致しません: ${table}（${before} → ${after}）`);
    process.exitCode = 1;
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
    sql: `select type, name, tbl_name, sql from sqlite_master
          where sql is not null and (name in (${placeholders}) or tbl_name in (${placeholders}))
          order by case type when 'table' then 0 else 1 end`,
    args: [...PUSH_TABLES, ...PUSH_TABLES],
  });

  if (ddl.rows.length === 0) {
    throw new Error("ローカルDBに対象テーブルがありません（先に npm run db:push）");
  }

  const tables = ddl.rows.filter((r) => String(r.type) === "table");
  const indexes = ddl.rows.filter((r) => String(r.type) !== "table");

  // 1. テーブル（無ければ作る。あるものはそのまま）
  for (const row of tables) {
    const name = String(row.name);
    try {
      await target.execute(withIfNotExists(String(row.sql)));
      console.log(`  作成/確認: table ${name}`);
    } catch (err) {
      console.log(`  失敗: ${name} — ${(err as Error).message.slice(0, 70)}`);
    }
  }

  // 2. 既存テーブルに増えた列を送る（CREATE IF NOT EXISTS では届かない）。
  // 3. そのあとで NOT NULL を外した列があれば作り直す（列がそろった状態で写す）
  for (const row of tables) {
    const name = String(row.name);
    await syncColumns(local, target, name);
    await rebuildIfLoosened(
      local,
      target,
      name,
      String(row.sql),
      indexes.filter((i) => String(i.tbl_name) === name).map((i) => String(i.sql)),
    );
  }

  // 4. インデックス（作り直したテーブルのぶんも、ここで IF NOT EXISTS の確認が通る）
  for (const row of indexes) {
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
  const tableNames = after.rows.filter((r) => r.type === "table").map((r) => String(r.name));
  const indexNames = after.rows.filter((r) => r.type === "index").map((r) => String(r.name));
  console.log("  テーブル:", tableNames.join(", "));
  console.log("  インデックス:", indexNames.length, "本");

  const missing = PUSH_TABLES.filter((t) => !tableNames.includes(t));
  local.close();
  target.close();

  if (missing.length > 0) {
    console.error(`\n作成できていないテーブル: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (process.exitCode === 1) {
    console.error("\n一部の変更を届けられませんでした。上のログを確認してください。");
    return;
  }
  console.log("\n完了しました。");
}

main().catch((err) => {
  console.error(`失敗: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
