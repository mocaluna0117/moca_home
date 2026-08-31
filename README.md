# もかのほーむ

[20and20.pet/store](https://20and20.pet/store/) (EC-CUBE) の**自分の購入履歴**を取得し、
一覧・検索・詳細で閲覧するローカル専用アプリ。
もかの毎日(ごはん・ワクチン・フィラリア・トリミング)の記録も同じアプリに入っており、
トップページ `/` はその日のもかを見せる**ホーム**、購入履歴は `/orders` にある。

## セットアップ

```bash
npm install
cp .env.example .env.local   # 認証情報を記入
npm run db:push              # SQLite にテーブル作成
npm run sync                 # 初回同期(全件取得のため2〜3分)
npm run dev                  # http://localhost:3000
```

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ起動 |
| `npm run sync` | CLI から全件同期 |
| `npm run sync -- --login-only` | 認証情報とページ数だけ検証 |
| `npm run db:push` | スキーマを SQLite に反映 |

画面右上の「同期」ボタンからも実行でき、進捗が `注文 34/69` のようにライブ表示される。

## 構成

- **Next.js 16 (App Router) + React 19 + Tailwind v4 + shadcn/ui**
- **SQLite (libSQL) + Drizzle ORM** — ローカルは `data/app.db`、本番は Turso。
  サーバコンポーネントから直接読み取り
- **スクレイパー** — `fetch` + `cheerio`(ヘッドレスブラウザ不要)

```
src/lib/scraper/  client(Cookie/待機/再試行) login orders products parse sync
src/lib/db/       schema index
src/lib/          queries(読み取り) format
src/app/          page(ホーム) orders products/[id] calendar care favorites api/sync
```

### ルート

| ルート | 内容 |
|---|---|
| `/` | **ホーム** — 今日のもか(写真・年齢・体重)、次の予定、最近のごはん、買ったもの集計 |
| `/orders` | 購入履歴一覧 — 注文ごと/商品ごとの切り替え、検索、お気に入り絞り込み |
| `/orders/[id]` | 注文詳細(明細・おまけの記録) |
| `/products/[id]` | 商品詳細(購入履歴・おまけ予測) |
| `/calendar` | カレンダー — ごはん、接種記録、トリミング・通院・フィラリアの印と今後の予定 |
| `/care` | フィラリアの予定と実績、トリミング・通院の記録 |
| `/favorites` | お気に入り |
| `/login` | `APP_PASSWORD` を設定したときだけ通る認証画面 |

## 設計上の要点

- **ページングは `?pageno=N`** — `page_no` は無視され、常に1ページ目が返る。
- **金額は整数円、日時は `+09:00` 付き ISO 文字列**で保存(`new Date(文字列)` は使わない)。
- **セレクタは `src/lib/scraper/parse.ts` に集約**。サイトの HTML が変わったらこのファイルだけを直す。
  取得できない場合は `SITE_LAYOUT_CHANGED` で即座に失敗させる。
- **販売終了商品**(商品ページが404)は `products.fetch_status='not_found'` とし、
  UI は常に `order_items` のスナップショット(商品名・画像・単価)から描画する。
- **個人情報は保存しない** — 注文詳細ページに埋め込まれた注文確認メール(住所・電話番号を含む)は
  パース前に DOM から除去しており、スキーマにも該当カラムが存在しない。
- **同期は冪等** — 詳細未取得(`detail_fetched_at IS NULL`)と未取得商品のみを対象にするため、
  中断しても次回実行で自己修復する。再同期は数秒。
- リクエスト間隔は既定 1 秒(`SCRAPER_DELAY_MS`)。`robots.txt` の `Disallow: /*.csv$` には触れない。

## デプロイ

Vercel + Turso への移行手順は [DEPLOY.md](DEPLOY.md) を参照。

## 注意

`.env.local`(認証情報)と `data/`(購入履歴・個人的なデータ)は `.gitignore` 済み。
