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

## 電子図書館

- 公開蔵書一覧: `/library/`
- 貸出・返却: `/students/library/`
- PDF閲覧: `/students/library/read/`
- 管理者によるPDF登録・貸出停止: `/admin/library/`

各資料は同時に1人、貸出から168時間（7日間）。D1上の条件付きUPSERTで同時貸出を防止し、期限を過ぎた貸出はクエリ時に無効として扱うため定期ジョブは不要です。期限前に返却できます。貸出IDを検証して、古い返却要求が新しい貸出を消さないようにしています。

### 初回セットアップ

既存の `DB` (`juis-admissions`) に追加テーブルだけを作成します。既存テーブルの変更はありません。

```bash
npx wrangler d1 execute juis-admissions --remote --file migrations/0001_library.sql
```

`wrangler.jsonc` の `LIBRARY_ACCESS_ISSUER`・`LIBRARY_STUDENT_AUD`・`LIBRARY_ADMIN_AUD` は既存Accessアプリから取得した公開設定です。新しい環境では対応する値に変更します。学生用と管理者用のJWTの署名・発行者・有効期限・audienceを別々に検証し、メールヘッダーだけを信用しません。`/students*`・`/api/students*`、`/admin*`・`/api/admin*` をそれぞれ既存のAccessアプリで保護します。利用者を増やす場合は学生ポータルのAccessポリシーに許可アドレスを追加してください。管理者ポリシーは分離して維持してください。

PDFは管理画面からアップロードします（1資料8MiBまで）。既存D1に256KiBずつ分割したBLOBとして格納し、本文をGit・公開アセット・公開URLに置きません。R2が未有効のアカウントでも動作し、大量の蔵書へ拡大する場合は本文保存先のR2移行を検討してください。登録内容とPDFは1回のD1 batchトランザクションで保存します。新規貸出の停止は既存借受人の期限内閲覧を妨げません。公開目録には借受人のメールや貸出IDを含めません。

PDF配信時と各チャンク取得時に貸出ID・借受人・期限を検証し、private/no-storeで配信します。閲覧画面も期限時にPDFを閉じ、15秒ごとに権限を再確認します。これはサイトへのアクセス制御であり、DRMではありません。保存済みPDF・スクリーンショットの回収や再配布の技術的な完全防止はできません。

```bash
# Node 24以上。SQLiteと署名済みJWTで貸出・期限・権限・PDF往復を確認
node --test tests/library.test.mjs
npx wrangler types --include-runtime false
npx tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types @cloudflare/workers-types worker/library.ts worker-configuration.d.ts
```
