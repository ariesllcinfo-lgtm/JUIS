// src/lib/getArticleUrl.ts
//
// articles の記事は type によって詳細ページの場所が違う：
// - News / Topics は専用の詳細ページ（/news/{id}/ / /topics/{id}/）を持つ
// - 学長の言葉・沿革は /about/ に埋め込み表示のみで、単独の詳細ページを持たない
// - それ以外（学部概要・教員紹介・シラバス・就職・教員募集など）は
//   共通の /articles/{id}/ を使う
//
// 1件の記事に複数のtypeを付けた場合でも、必ず存在するURLに
// リンクできるよう、ここで一箇所にリンク解決ロジックをまとめている。
// 新しい「専用詳細ページを持つtype」が増えたら、この関数だけ直せばよい。

interface ArticleLike {
  id: string;
  type?: string[];
}

export function getArticleUrl(item: ArticleLike): string {
  if (item.type?.includes("News")) return `/news/${item.id}/`;
  if (item.type?.includes("Topics")) return `/topics/${item.id}/`;
  return `/articles/${item.id}/`;
}
