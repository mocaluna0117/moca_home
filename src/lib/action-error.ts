/**
 * Server Action が catch した例外を、画面に出してよい1行に変える。
 *
 * 素の `err.message` を返してはいけない。drizzle は失敗を
 * DrizzleQueryError で包み、その message は
 *
 *   Failed query: insert into "dog_profile" ("id", "name", …) values (?, ?, …)
 *   params: 1,もか,,,,,,,,2026-08-31T21:10:22+09:00,…
 *
 * という**SQL 文と全パラメータ値**になる。これをトーストに出すと
 *  1. 本当の原因（no such table: dog_profile）が文字列のどこにも無い
 *  2. 入力値が画面に転記される
 * の2つが同時に起きる。実際に起きたので直した。
 *
 * 原因は cause に入っている:
 *   DrizzleQueryError.message  = "Failed query: … params: …"   ← 出さない
 *   .cause  (LibsqlError)      = "SQLITE_ERROR: no such table: dog_profile"
 *   .cause.cause               = "no such table: dog_profile"  ← これを出す
 */

/** 一番奥の cause まで辿る。drizzle → libsql → sqlite の2段包みがある */
function deepestCause(err: unknown): unknown {
  let cur = err;
  for (let i = 0; i < 8; i++) {
    const next: unknown = (cur as { cause?: unknown } | null)?.cause;
    if (next === undefined || next === null || next === cur) break;
    cur = next;
  }
  return cur;
}

function messageOf(err: unknown): string | null {
  if (err instanceof Error && err.message !== "") return err.message;
  if (typeof err === "string" && err !== "") return err;
  return null;
}

/**
 * drizzle が包んだ「クエリ本文入り」の message か。
 * これに当たったら、包みの外ではなく中身を見に行く。
 */
function isQueryDump(message: string): boolean {
  return message.startsWith("Failed query:");
}

/** "SQLITE_ERROR: no such table: x" → "no such table: x" */
function stripSqliteCode(message: string): string {
  return message.replace(/^SQLITE_[A-Z_]+:\s*/, "");
}

/**
 * 画面に出す1行を作る。
 *
 * - DB エラー: `${fallback}（no such table: dog_profile）`。原因が読めないと
 *   「保存に失敗しました」だけが出て、こちらは何も直せない。テーブル名や
 *   制約名は出るが、このアプリは単一利用者のパスワードゲートの内側にあり、
 *   SQL 文とパラメータ値を出さないことのほうが実利が大きい。
 * - 自分で throw した Error（環境変数の不足など、既に日本語）: そのまま出す。
 * - それ以外: fallback だけ。
 *
 * 詳細（包みの message = SQL とパラメータを含む）は握り潰さず
 * console.error に回す。サーバのログには残り、画面には出ない。
 */
export function actionError(err: unknown, fallback: string): string {
  console.error(`[action] ${fallback}`, err);

  const outer = messageOf(err);
  if (outer === null) return fallback;

  if (!isQueryDump(outer)) return outer;

  const detail = messageOf(deepestCause(err));
  if (detail === null || isQueryDump(detail)) return fallback;

  return `${fallback}（${stripSqliteCode(detail)}）`;
}
