# Vercel へのデプロイ手順

Vercel はファイルを保存できないため、SQLite の中身を **Turso**(SQLite互換のマネージドDB)へ移します。
コードは libSQL 1本に統一済みで、ローカルは `file:` URL、本番は Turso URL を見るだけの違いです。

## 0. 前提

- GitHub リポジトリ: `mocaluna0117/20_and_20_management`(現在 **Public**。気になる場合は Private に変更を推奨)
- ローカルの `data/app.db` に取り込み済みのデータ(注文69件・商品1,480件)

## 1. Turso のセットアップ（あなたの操作・ブラウザのみ）

CLI は不要です（Homebrew 版は `libsql/sqld` タップへの依存で失敗することがあります）。

1. https://app.turso.tech を開き、GitHub アカウントでサインアップ
2. **Create Database** → 名前 `20and20`、リージョンは **Tokyo (nrt)**
3. 作成後の画面で次の2つを控える
   - **Database URL**（`libsql://20and20-xxxx.turso.io`）
   - **Auth Token**（トークン作成ボタンから生成）

> **Auth Token は「+ Create Token」で生成**します。表示は一度きりなのですぐコピーしてください。
> 権限は **Full Access**（読み書き）、有効期限は Never で構いません。
> Read Only にするとおまけの記録や同期が保存できません。

## 2. 接続情報をファイルに置く

`.env.turso.example` をコピーして `.env.turso` を作り、トークンを貼ります
（`.env.*` は gitignore 済み。チャットや git に出さないこと）。

```bash
cp .env.turso.example .env.turso
# エディタで TURSO_AUTH_TOKEN を埋める
```

## 3. 既存データを Turso へ移す

同梱の移行スクリプトが、ローカルの `data/app.db` からスキーマごとコピーします
（`@libsql/client` がローカルの `file:` DB も読めるため、追加ツールは不要）。

```bash
npm run db:migrate
```

最後に件数の照合結果が出ます（orders 69 / products 1480 など）。
各テーブルを空にしてから入れ直すので、**途中で失敗しても再実行すれば復旧**します。

## 4. Vercel へデプロイ（あなたの操作）

```bash
npx vercel login
npx vercel link          # 既存プロジェクトを作成/紐付け
```

環境変数を設定します（`vercel env add <名前> production` で対話入力）:

| 変数 | 値 |
|---|---|
| `TURSO_DATABASE_URL` | 手順1の `libsql://...` |
| `TURSO_AUTH_TOKEN` | 手順1のトークン |
| `AUTH_SECRET` | `openssl rand -hex 32` の出力 |
| `APP_PASSWORD` | アプリを開くためのパスワード（自分で決める） |
| `ECCUBE_BASE_URL` | `https://20and20.pet/store` |
| `ECCUBE_LOGIN_EMAIL` | ショップのメールアドレス |
| `ECCUBE_LOGIN_PASSWORD` | ショップのパスワード |
| `SCRAPER_DELAY_MS` | `1000`（ショップへの負荷を抑えるため下げない） |

```bash
npx vercel --prod
```

## 5. デプロイ後の確認

- 未ログインで開くと `/login` に飛ぶ。`/api/catalog` を直接叩くと 401
- パスワードを入れると購入履歴が表示される（Turso のデータ）
- おまけを記録 → 保存できる（Turso に書き込まれる）
- ヘッダーの「カタログ同期」ボタンは**表示されない**（下記）

## 同期の運用

| 種類 | どこで実行 | 所要時間 |
|---|---|---|
| 注文同期（ヘッダーの「同期」） | Vercel 上で可 | 初回2〜3分・以降10秒程度 |
| カタログ同期（全商品IDスイープ） | **手元のCLIのみ** | 初回約30分・以降4〜5分 |

カタログ同期は27分かかるため Vercel の関数上限（Hobby は最大300秒）を超えます。デプロイ環境では
ボタンを出さず、API を直接叩いても 501 を返します。手元から**本番DBに向けて**実行してください:

```bash
npm run sync:prod -- --catalog     # .env.turso を読んで本番DBに書き込む
```

`sync_runs` テーブルで実行中ロックを取るため、CLI と Vercel の同時実行はどちらか一方が
「同期が既に実行中です」で弾かれます。

## 写真の保存先（Vercel Blob）

ワクチン接種証明書の写真を使うには Blob ストアが必要です（未設定でも
日付・ワクチン名・メモは保存できます）。

1. Vercel プロジェクトの **Storage** → **Create Database** → **Blob**
2. アクセスは **Private** を選ぶ（証明書には氏名・住所・動物病院名が写るため）
3. 作成すると `BLOB_READ_WRITE_TOKEN` が自動で環境変数に入る
4. 手元でも写真を扱うなら、ストアの **Projects** タブ → ⋯ → **Update Project Connection** で
   **Development** にもチェックを入れてから `npx vercel env pull` する
   （Development が未接続だと `BLOB_READ_WRITE_TOKEN` は本番にしか入らず、
   手元では写真UIが出ません。文字情報の記録は使えます）

| 変数 | 値 |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Blob ストア作成時に自動で入る（手動設定は不要） |

## 注意点

- **Vercel のデータセンターIPからショップにログイン**します。弾かれるようなら注文同期も CLI 実行に切り替えてください（コード変更は不要、`npm run sync:prod`）
- `.env.local` と `data/` は gitignore 済み。認証情報をコミットしないでください
- ローカル開発は今まで通り。`APP_PASSWORD` を未設定にすればログイン画面は出ません
