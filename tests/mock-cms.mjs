// ビルドの回帰確認用。実CMS・APIキーを使わず101件以上を返す。
const originalFetch = globalThis.fetch;
const article = (id, type, title = id) => ({
  id, title, ...(type === undefined ? {} : { type }),
  content: '<h2>本文の見出し</h2><p>一般記事の本文です。<strong>強調</strong>とリンクを掲載できます。</p><blockquote>引用文</blockquote><table><tbody><tr><th>項目</th><td>内容</td></tr></tbody></table>',
  publishedAt: '2026-10-08T00:00:00.000Z', createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
});
const articles = process.env.CMS_TEST_EMPTY === '1' ? [] : [
  ...Array.from({ length: 101 }, (_, i) => article(`article-${i}`, ['記事'], `一般記事 ${i}`)),
  article('untyped', undefined, '未分類の記事'), article('empty-type', []),
  article('news-old', ['News']), article('topics-old', ['Topics']),
  article('faculty-old', ['教員紹介']), article('syllabus-old', ['シラバス']),
  article('news-mixed', ['記事', 'News']), article('embedded', ['沿革']),
  article('script-title', ['記事'], '</script><script>window.injected=true</script>'),
];
if (articles[0]) articles[0].eyecatch = { url: 'https://juis-ac.jp/images/main.png', width: 1536, height: 1024 };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input);
  if (url.hostname !== 'fixture.microcms.io') return originalFetch(input, init);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 10);
  const contents = articles.slice(offset, offset + limit);
  return Response.json({ contents, totalCount: articles.length, offset, limit });
};
