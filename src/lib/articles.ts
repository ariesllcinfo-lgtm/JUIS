import { createClient, type MicroCMSDate, type MicroCMSImage } from "microcms-js-sdk";

export interface Article extends MicroCMSDate {
  id: string;
  title: string;
  content?: string;
  type?: string[];
  eyecatch?: MicroCMSImage;
  [key: string]: any;
}

// 既存の用途別記事は一般記事一覧に混ぜない。未分類の記事も掲載できる。
const specializedTypes = [
  "News", "Topics", "学長の言葉", "沿革", "書籍", "学部概要", "大学院概要",
  "シラバス", "教員募集", "附属機関", "教員紹介", "出版物", "就職",
];
export function isGeneralArticle(item: Pick<Article, "type">): boolean {
  return !item.type?.some((type) => specializedTypes.includes(type));
}

let articlesPromise: Promise<Article[]> | undefined;
export function getArticles(): Promise<Article[]> {
  // 一覧と詳細が同じ公開済みデータを使う。取得失敗時はビルドを止め、空のサイトを公開しない。
  return articlesPromise ??= createClient({
    serviceDomain: import.meta.env.MICROCMS_SERVICE_DOMAIN,
    apiKey: import.meta.env.MICROCMS_API_KEY,
  }).getAllContents<Article>({
    endpoint: "articles",
    queries: { orders: "-publishedAt,-createdAt" },
  });
}

export function articleDescription(item: Pick<Article, "content" | "title">): string {
  return (item.content ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim().slice(0, 140) || item.title;
}

export function formatArticleDate(value?: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Date(value).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  });
}
