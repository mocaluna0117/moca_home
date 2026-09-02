# Vercel へのデプロイ手順

- GitHub リポジトリ: `mocaluna0117/moca_home`
- Vercel プロジェクト: `moca-home`
- 本番URL: `https://moca-home.vercel.app`
  （`moca-home-mocalunas-projects.vercel.app` でも同じものが開きます）
- ローカルの作業フォルダ: `~/moca_home`

> 旧URL `20and20managementapp.vercel.app` は、プロジェクト改名前に発行された
> ものです。Vercel は改名前のURLが生き続けることを保証しないので、
> ブックマークは新URLに張り替えてください。

Vercel はファイルを保存できないため、SQLite の中身を **Turso**(SQLite互換のマネージドDB)へ移します。
コードは libSQL 1本に統一済みで、ローカルは `file:` URL、本番は Turso URL を見るだけの違いです。

## 0. 前提

- リポジトリは現在 **Public** です。気になる場合は Private に変更を推奨します。
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
- パスワードを入れるとホーム（今日のもか・次の予定・買ったものの集計）が表示される（Turso のデータ）。
  購入履歴は `/orders`（ヘッダーの「購入履歴」タブ）
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

## テーブルや列を足したとき（スキーマ変更）

**`git push` はコードしか本番に届けません。スキーマは追随しません。** Vercel は
リポジトリからビルドするだけで、Turso のテーブルには触りません。足したテーブルを
本番に届けるのは下の手順だけです。

```bash
# 1. src/lib/db/schema.ts に定義を書く
# 2. ローカルDBに反映
npm run db:push
# 3. scripts/push-log-tables.ts の PUSH_TABLES にテーブル名を追加  ← 忘れやすい
# 4. 本番DBに反映（.env.turso を読む）
npm run db:push:log
```

出力の `作成/確認: table <名前>` と、末尾の「対象DBの状態」の一覧に名前が
あることを目で確認してください。`CREATE TABLE IF NOT EXISTS` なので何度
実行しても安全です。

**3 を忘れると、本番だけが実行時に `no such table: …` で落ちます。** ローカルは
2 で作られているので気づけません。`/`（ホーム）がサイトの入口になったので、
ホームが読むテーブルを1枚落とすと全ページに到達できなくなります。
実際に `dog_profile` でこれが起きました（2026-08-31。プロフィールの保存が
「保存に失敗しました（no such table: dog_profile）」で失敗した）。
`getDogProfile()` の try/catch はその1枚ぶんの保険で、他のテーブルには
同じ受け皿がありません。

**なぜ2手に分かれるのか**: `drizzle-kit push`（手順2）は本番に向けません。
このリポジトリで実際にテーブルだけ作ってインデックスを落とし、次回実行時に
`no such index` で止まったことがあります。`push-log-tables.ts` は
ローカルDBの `sqlite_master` にある `CREATE` 文をそのまま再生するので取りこぼしません。

**既存テーブルに列を足すときは、必ず nullable か既定値つきにしてください。**
SQLite は既定値の無い `NOT NULL` 列を後から `ALTER` で足せないため、
スクリプトの `syncColumns` は「要手動」と出して飛ばします。

## 写真の保存先（Vercel Blob）

写真を使うには Blob ストアが必要です（未設定でも文字の記録は全部使えます。
証明書なら日付・ワクチン名・メモ、プロフィールなら名前・誕生日・体重）。

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

### ストアは1つ・接頭辞で用途を分ける

もかのプロフィール写真が増えましたが、**ストアの追加作成も権限変更も不要**です
（同じストアの新しい接頭辞を使うだけ）。既に Blob を作ってあるなら何もしなくて構いません。

| 接頭辞 | 用途 | 受け入れる形式 | 上限 |
|---|---|---|---|
| `vaccinations/` | ワクチン接種証明書 | jpeg / png / webp / **heic / heif** | 20MB |
| `profile/` | もかのプロフィール写真 | jpeg / png / webp | 8MB |

`profile/` が HEIC を受けないのは、変換に失敗した原本がそのまま上がったとき
desktop の Chrome / Firefox が `<img>` で描けないためです（丸い顔写真が出ないのは、
証明書のサムネイルが出ないのとは重みが違います）。証明書側は今までどおり HEIC も受けます。
プロフィールは長辺1200pxのJPEGに変換して上げるので、8MBに当たることは実際にはありません。

判定は `src/lib/blob.ts` の `BLOB_PREFIXES` と `PHOTO_RULES` の1箇所だけです。
中身は `vercel blob list vaccinations/` / `vercel blob list profile/` で確認できます。
**3つ目の用途を足すときは接頭辞を増やすこと**（既存の接頭辞の判定を緩める変更は、
トークン発行と Server Action の両方が通る唯一の関門を緩めるので必ず穴になります）。

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

## 毎日の定期実行（cron）

1日1回 `/api/cron/daily` を Vercel Cron が叩きます（`vercel.json` の `crons`、
`0 23 * * *`（UTC）＝ 日本時間の朝8時台）。**cron は Hobby プランでは1日1回まで**なので、
定期の仕事は全部この1本に相乗りさせます。エンドポイントを増やさないのは、認証ゲートの
通り道を1本に閉じ込めておくためでもあります（`src/lib/cron-auth.ts` の `CRON_PATH`）。

| 順番 | 仕事 | 中身 |
|---|---|---|
| 1 | いつものご飯 | 今日の朝・夜がまだ空なら、登録した「いつものご飯」を記録として入れる |
| 2 | フィラリアのリマインド | 予定日のぶんをメールで送る（下の節） |

**ご飯が先なのは順番に意味があります。** SMTP は最悪90秒近く粘るので、逆順にすると
`maxDuration`（120秒）に食われてその日の記録が落ちます。片方が失敗しても他方は走ります
（失敗したほうだけ `{"ok":false,"error":"…"}` になって同じ JSON に出ます）。

ご飯のほうは**遡りません**。空のスロットは「まだ入れていない」と「わざと空にした」が
区別できないので、取り戻すと飼い主が消した記録を復活させてしまいます。cron が走らなかった
日は空のまま残り、「記録」タブの「前回をコピー」で埋められます。リマインドメールだけは
7日前までを拾います（メールは消す対象が無いため）。

### 環境変数

| 変数 | 値 |
|---|---|
| `CRON_SECRET` | 16文字以上のランダムな文字列（Secret にする） |

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

**`CRON_SECRET` が未設定だと cron は 401 になり、ご飯の記録もリマインドも走りません。**
設定を忘れて誰でも叩ける口ができるより、動かないほうが気づけるためです。

### 動きの確認

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<あなたのURL>/api/cron/daily
```

```json
{
  "meals": { "ok": true, "today": "2026-09-02", "created": 2, "skipped": 0, "unresolved": 0 },
  "reminder": { "today": "2026-09-02", "due": 0, "sent": 0 }
}
```

`created` は入れた品目の数、`skipped` はすでに記録があって見送ったスロットの数（正常）です。

**`unresolved` が 0 でない日は放置してはいけません。** 登録した商品が
カタログから消えていて品目を解決できず、そのスロットを丸ごと見送った数です。
部分的に入れると食べた品数が嘘になるので1行も書きませんが、**直すまで毎日
入りません**。画面には「まだ」と出るだけで cron が動いていない場合と区別が
付かないので、この数字が唯一の手がかりです。いつものご飯の登録を開いて
商品を選び直してください。
**2回叩いても2回目の `created` は0**（同じ日はもう決着している）。翌朝
`/calendar` の「いつもの」タブに「今日の朝ごはん: 記録あり」と出ていれば、
cron が実際に走った証拠です（自動で入れた記録に印は付かないので、確認できるのはこれだけ）。

### パスを変えたときは Redeploy してから4つ確認する

**`crons` はデプロイ時に登録されます。** `vercel.json` を書き換えたコミットを push しても、
本番を Redeploy するまで cron は**古いパスを叩き続けます**（その日は記録が入らず、空のまま
残ります）。ロールバックすると古いパスに戻ります。Deployments → ⋯ → Redeploy のあと、
次の4つを確認してください。

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<あなたのURL>/api/cron/daily  # (a)
curl -i https://<あなたのURL>/api/cron/daily                                          # (b)
curl -i https://<あなたのURL>/api/cron/heartworm                                      # (c)
```

- **(a) 200** — ヘッダ付きなら新しいパスが通る
- **(b) 401** — ヘッダ無しでは通らない
- **(c) 401** — 旧パスも 401。特別扱い（`CRON_PATH`）を失って通常の認証ゲートの下に
  落ちただけで、**開いたURLが1つも増えていない**ことの確認です。404 ではなく 401 が正解
- **(d)** Vercel プロジェクトの **Cron Jobs** が `/api/cron/daily` の**1件だけ**になっている

## フィラリアのリマインドメール（任意）

予定日の朝にメールでお知らせします。**未設定でも予定と実績の記録は使えます**
（画面に「今日はフィラリアの日です」は出ます）。

### 1. Gmail のアプリパスワードを発行する

1. https://myaccount.google.com/security で **2段階認証をオン**にする
2. https://myaccount.google.com/apppasswords を開く
3. 名前を付けて作成すると **16桁**が表示される（4桁ずつ区切って出るが、
   空白入りのままコピーしてよい。アプリ側で取り除く）

### 2. Vercel に環境変数を追加する

| 変数 | 値 |
|---|---|
| `GMAIL_USER` | 送信元にする Gmail アドレス |
| `GMAIL_APP_PASSWORD` | 上で発行した16桁（Secret にする） |
| `HEARTWORM_MAIL_TO` | 宛先。カンマ区切りで複数可（5件まで） |
| `NEXT_PUBLIC_APP_URL` | 省略可。メール本文に載せるURL（`https://moca-home.vercel.app`） |

`CRON_SECRET` も必要ですが、これは cron の口そのものの鍵なので上の
「毎日の定期実行（cron）」で設定します。**未設定だとリマインドは飛びません。**

### 3. デプロイする

`vercel.json` の `crons` は **デプロイ時に登録**されます。環境変数を足しただけでは
反映されないので、Deployments → ⋯ → Redeploy を実行してください。

### 動きの確認

`/api/cron/daily` を叩き（→「毎日の定期実行（cron）」）、返ってきた JSON の
`reminder` を見ます。`{"today":"...","due":1,"sent":1}` なら送信できています。
`due` が0なら今日送るべき予定がありません（予定が未来か、記録済みか、送信済み）。
並んでいる `meals` はいつものご飯の記録づくりで、リマインドとは無関係です。

### 仕様

- 走るのは1日1回・日本時間の朝8時台（→「毎日の定期実行（cron）」）
- 送る前に「送信済み」の印を付けてから送るので、cron が二重に走っても同じメールは1通だけ
- 送信に失敗したら印を戻し、理由を記録します（画面に出ます）。翌朝もう一度試みます
- cron が止まっていた日を取り戻すため、**7日前までの未送信ぶん**を拾います
- 「飲ませた」を記録すると、その予定のリマインドは止まります
- Vercel の Function は **25番ポートが塞がれています**が 465 と 587 は通ります。
  既定は465。塞がれた場合は `SMTP_HOST` / `SMTP_PORT` で差し替えられます

## 注意点

- **Vercel のデータセンターIPからショップにログイン**します。弾かれるようなら注文同期も CLI 実行に切り替えてください（コード変更は不要、`npm run sync:prod`）
- `.env.local` と `data/` は gitignore 済み。認証情報をコミットしないでください
- ローカル開発は今まで通り。`APP_PASSWORD` を未設定にすればログイン画面は出ません
- **`src/middleware.ts` の matcher に新しい除外を足さないこと。** 除外は
  「認証ゲートの外にあるURL」を増やします。cron の経路も matcher からは外さず、
  middleware の中で `Authorization: Bearer` を検証して通しています。
  なお middleware は edge runtime でビルドされるため、そこから import する
  `src/lib/cron-auth.ts` は `node:crypto` も `Buffer` も使えません
- **`src/middleware.ts` の matcher に「拡張子で終わるパス」の除外を足さないこと。**
  以前これがあったため、`/api/vaccination-photos/1.jpg` が未認証で証明書を返していました
  （ルート側が `parseInt("1.jpg")` を 1 と読むため）。URLのIDは
  `parseIdParam()` で検証すること
