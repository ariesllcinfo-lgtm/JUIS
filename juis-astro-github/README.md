# JUIS Astro Website

城北情報大学の公式サイトをAstroで再構成したプロジェクトです。

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

現在の画像はプレースホルダーです。運用前に権利を保有する画像へ差し替えてください。`astro.config.mjs` の `site` も実際のドメインへ変更してください。
