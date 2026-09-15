// src/pages/llms.txt.ts
//
// llms.txt は robots.txt やsitemap.xmlとは別に、LLM/アンサーエンジン向けに
// 「このサイトで重要なページはここ」を人間可読なMarkdownで示す案内ファイル。
// クロール許可の仕組みではなく、あくまで推奨リストなのでrobots.txtと役割を分けている。
// articlesの内容に応じてビルド時に自動生成されるため、記事を追加しても手動更新は不要。

import type { APIRoute } from "astro";
import { createClient } from "microcms-js-sdk";
import { getArticleUrl } from "../lib/getArticleUrl";

export const GET: APIRoute = async ({ site }) => {
  const base = site?.toString().replace(/\/$/, "") ?? "https://juis-ac.jp";

  let items: any[] = [];
  try {
    const client = createClient({
      serviceDomain: import.meta.env.MICROCMS_SERVICE_DOMAIN,
      apiKey: import.meta.env.MICROCMS_API_KEY,
    });
    const res = await client.get({ endpoint: "articles", queries: { limit: 100 } });
    items = res.contents;
  } catch (error) {
    console.error("llms.txt: articlesの取得に失敗しました", error);
  }

  const section = (label: string, typeName: string, max = 20) => {
    const list = items.filter((i) => i.type?.includes(typeName)).slice(0, max);
    if (list.length === 0) return "";
    const lines = list.map((i) => `- [${i.title}](${base}${getArticleUrl(i)})`).join("\n");
    return `## ${label}\n\n${lines}\n`;
  };

  const body = `# 城北情報大学 (Johoku University of Information Studies)

> 東京都豊島区に所在する大学の公式サイト。学部・大学院、入試情報、シラバス、教員紹介、お知らせを掲載。

## 主要ページ

- [ホーム](${base}/)
- [大学紹介](${base}/about/)
- [学部・大学院](${base}/academics/)
- [シラバス一覧](${base}/academics/syllabus/)
- [教育・研究](${base}/research/)
- [入試情報](${base}/admissions/)
- [就職・キャリア支援](${base}/career/)
- [教員採用情報](${base}/about/recruitment/)

${section("お知らせ (News)", "News")}
${section("Topics", "Topics")}
${section("教員紹介", "教員紹介")}
${section("附属機関", "附属機関")}
${section("出版物", "出版物")}
`.replace(/\n{3,}/g, "\n\n");

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
