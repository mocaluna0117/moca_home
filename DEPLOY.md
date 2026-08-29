# Vercel へのデプロイ手順

Vercel はファイルを保存できないため、SQLite の中身を **Turso**(SQLite互換のマネージドDB)へ移します。
コードは libSQL 1本に統一済みで、ローカルは `file:` URL、本番は Turso URL を見るだけの違いです。

## 0. 前提

- GitHub リポジトリ: `mocaluna0117/20_and_20_management`(現在 **Public**。気になる場合は Private に変更を推奨)
- ローカルの `data/app.db` に取り込み済みのデータ(注文69件・商品1,480件)

## 1. Turso のセットアップ（あなたの操作）

```bash
brew install tursodatabase/tap/turso
turso auth signup                 # ブラウザが開きます

turso db create 20and20           # DB作成
turso db show 20and20 --url       # → libsql://20and20-xxxx.turso.io  （控える）
turso db tokens create 20and20    # → 認証トークン（控える）
```

## 2. 既存データを Turso へ移す

```bash
# ローカルDBをダンプして流し込む（スキーマもデータも一括）
sqlite3 data/app.db .dump > /tmp/app-dump.sql
turso db shell 20and20 < /tmp/app-dump.sql

# 件数が一致するか確認
turso db shell 20and20 "select count(*) from orders;"      # 69
turso db shell 20and20 "select count(*) from products;"    # 1480
```

やり直したい場合は `turso db destroy 20and20` → 手順1のDB作成からやり直すのが確実です。

## 3. Vercel へデプロイ（あなたの操作）

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

## 4. デプロイ後の確認

- 未ログインで開くと `/login` に飛ぶ。`/api/catalog` を直接叩くと 401
- パスワードを入れると購入履歴が表示される（Turso のデータ）
- おまけを記録 → 保存できる（Turso に書き込まれる）
- ヘッダーの「カタログ同期」ボタンは**表示されない**（下記）

## 同期の運用

| 種類 | どこで実行 | 所要時間 |
|---|---|---|
| 注文同期（ヘッダーの「同期」） | Vercel 上で可 | 初回2〜3分・以降10秒程度 |
| カタログ同期（全商品IDスイープ） | **手元のCLIのみ** | 初回約30分・以降4〜5分 |

カタログ同期は27分かかるため Vercel の関数上限（最大800秒）を超えます。デプロイ環境ではボタンを出さず、
API を直接叩いても 501 を返します。手元から**本番DBに向けて**実行してください:

```bash
TURSO_DATABASE_URL='libsql://...' TURSO_AUTH_TOKEN='...' npm run sync -- --catalog
```

`sync_runs` テーブルで実行中ロックを取るため、CLI と Vercel の同時実行はどちらか一方が
「同期が既に実行中です」で弾かれます。

## 注意点

- **Vercel のデータセンターIPからショップにログイン**します。弾かれるようなら注文同期も CLI 実行に切り替えてください（コード変更は不要、上と同じ環境変数を付けて `npm run sync`）
- `.env.local` と `data/` は gitignore 済み。認証情報をコミットしないでください
- ローカル開発は今まで通り。`APP_PASSWORD` を未設定にすればログイン画面は出ません
