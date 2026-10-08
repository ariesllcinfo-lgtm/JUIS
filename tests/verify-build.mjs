import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const html = (path) => readFile(`dist/${path}/index.html`, 'utf8');
const listing = await html('articles');
if (process.env.CMS_TEST_EMPTY === '1') {
  assert.ok(listing.includes('現在、公開されている記事はありません。'));
  assert.ok((await html('')).includes('記事・コラム'));
  console.log('Empty CMS build verified');
  process.exit(0);
}
for (const id of ['article-100', 'untyped', 'empty-type']) {
  assert.ok(listing.includes(`/articles/${id}/`), `${id} should be listed`);
  await access(`dist/articles/${id}/index.html`);
}
for (const id of ['news-old', 'topics-old', 'faculty-old', 'syllabus-old', 'news-mixed', 'embedded']) {
  assert.ok(!listing.includes(`/articles/${id}/`), `${id} should not be a general article`);
}
assert.ok((await html('news')).includes('/news/news-old/'));
assert.ok((await html('topics')).includes('/topics/topics-old/'));
assert.ok((await html('research')).includes('/articles/faculty-old/'));
assert.ok((await html('academics/syllabus')).includes('/articles/syllabus-old/'));
assert.ok((await html('news/news-mixed')).includes('news-mixed'));
const detail = await html('articles/article-100');
assert.ok(detail.includes('← 記事一覧に戻る'));
assert.ok(detail.includes('公開日：'));
assert.ok(detail.includes('更新日：'));
assert.ok(detail.includes('property="og:type" content="article"'));
assert.ok(detail.includes('本文の見出し'));
const dangerous = await html('articles/script-title');
for (const [, json] of dangerous.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
  JSON.parse(json);
  assert.ok(!json.includes('<script>'));
}
assert.ok(dangerous.includes('\\u003c/script>'));
assert.ok((await readFile('dist/sitemap-0.xml', 'utf8')).includes('/articles/article-100/'));
assert.ok((await html('')).includes('/articles/article-0/'));
console.log('Article discovery, >100 records, specialized routes, metadata, and JSON-LD verified');
