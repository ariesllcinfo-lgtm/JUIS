# JUIS Astro Website

城北情報大学の公式サイトをAstroで構成したプロジェクトです。

## ローカル確認

```bash
npm install
npm run dev
```

## Cloudflare Pages

- Framework preset: Astro
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`

GitHubへこのフォルダの中身をアップロードし、Cloudflare Pagesからリポジトリを接続してください。

## ページ

- `/` ホーム
- `/academics/` 学部・大学院
- `/about/` 大学紹介
- `/admissions/` 入試情報

## 注意

## 一般記事・コラムの掲載

一般記事は既存のmicroCMS `articles` APIで管理します。新しいAPIや投稿システムの契約は不要です。

1. microCMSの `articles` APIの `type`（セレクト）に「記事」を追加します。
2. 新しいコンテンツに `title`（タイトル）、`content`（リッチエディタ本文）を入力し、`type` に「記事」を選びます。
3. 必要に応じて `eyecatch` に画像を登録し、「公開」します。
4. Cloudflareで再ビルド・デプロイします。公開先は `/articles/{コンテンツID}/`、一覧は `/articles/` です。

`type` が空または未設定の記事も一般記事として掲載します。ただし現在のCMSで `type` が必須の場合は「記事」の選択肢を追加してください。News・Topics・学部概要・教員紹介などの既存の用途別分類を一緒に選ぶと、用途別の扱いを優先し一般記事一覧から除外します。

トップページには新着3件、記事一覧には一般記事を新しい公開日順で表示します。本文から抜粋を作り、詳細には公開日・更新日・画像、SNS共有用メタ情報とArticle構造化データを出力します。公開済み記事は100件を超えても取得します。

このサイトは静的生成です。CMS上の公開・更新だけではサイトは切り替わりません。自動反映する場合はCloudflareのDeploy Hookを作成し、microCMSのWebhookで公開・更新・非公開・削除時に呼び出してください。Hook URLやAPIキーはリポジトリに書かず、各サービスの設定画面で管理します。

### ビルド回帰確認（実CMS不要）

```bash
MICROCMS_SERVICE_DOMAIN=fixture MICROCMS_API_KEY=test NODE_OPTIONS="--import=./tests/mock-cms.mjs" npm run build
node tests/verify-build.mjs
```

実際の公開用ビルドにはCloudflareの環境変数 `MICROCMS_SERVICE_DOMAIN` と `MICROCMS_API_KEY` を設定します。上記のfixtureは確認専用です。
