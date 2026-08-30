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

## 証明書の自動読み取り（任意）

接種証明書の写真を選ぶと、接種日・ワクチン名・動物病院・次回予定日を
自動でフォームに入れる機能です。**未設定でも写真の添付と手入力は使えます。**

### どちらか一方を設定する

| | Gemini（推奨・無料枠あり） | Claude |
|---|---|---|
| 料金 | 無料枠の範囲なら0円 | 従量課金（1枚10円前後） |
| キーの発行 | https://aistudio.google.com/apikey | https://console.anthropic.com/ |
| 環境変数 | `GEMINI_API_KEY` | `ANTHROPIC_API_KEY` |
| モデル指定（省略可） | `GEMINI_MODEL`（既定 `gemini-2.5-flash`） | `ANTHROPIC_MODEL`（既定 `claude-opus-5`） |
| 送った画像の扱い | **無料枠は規約上、Google の製品改善に使われうる**（人が見る場合があると明記されている） | 学習に使われない |

両方設定した場合は **Gemini が優先** されます。
Vercel の **Settings → Environment Variables** に Secret として追加してください。
手元でも試すなら `.env.local` にも同じ行を足します。

### 送る前に黒塗りできる

写真を選ぶと「送る前に隠す」画面が開きます。飼い主名・住所など送りたくない
部分をなぞると黒く塗られ、**塗ったあとの画像だけ**が送られます。
**保存される写真は塗られません**（手元の記録としての価値を落とさないため）。

### 送られるもの・送られないもの

- **送られる**: 黒塗り後の画像（長辺2000pxのJPEG）。
  Blob の URL やパスは送りません（画像のバイト列だけを送る作りです）。
- **保存される**: 接種日・ワクチン名・動物病院名・次回予定日の4つだけ。
  読み取り結果はフォームに入るだけで、保存ボタンを押すまでDBには何も書きません。
- **捨てられる**: 住所・電話・氏名・敬称・「院長」などを含む値は
  `src/lib/vaccination-extract.ts` がまるごと破棄します（切り詰めて残すことはしません）。
- **走らない場合**: キー未設定のとき、HEIC など変換できない画像のとき、
  4項目がすべて埋まっているとき（編集で写真だけ足す場合）。

気になる場合はキーを設定しないでください。写真の添付と拡大表示だけが動きます。

## 注意点

- **Vercel のデータセンターIPからショップにログイン**します。弾かれるようなら注文同期も CLI 実行に切り替えてください（コード変更は不要、`npm run sync:prod`）
- `.env.local` と `data/` は gitignore 済み。認証情報をコミットしないでください
- ローカル開発は今まで通り。`APP_PASSWORD` を未設定にすればログイン画面は出ません
- **`src/middleware.ts` の matcher に「拡張子で終わるパス」の除外を足さないこと。**
  以前これがあったため、`/api/vaccination-photos/1.jpg` が未認証で証明書を返していました
  （ルート側が `parseInt("1.jpg")` を 1 と読むため）。URLのIDは
  `parseIdParam()` で検証すること
