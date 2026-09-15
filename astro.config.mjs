import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://juis-ac.jp',
  output: 'static',
  integrations: [
    sitemap({
      // 管理画面・在学生専用の機能ページはサイトマップからも除外する
      filter: (page) =>
        !page.includes('/admin/') &&
        !page.includes('/students/account') &&
        !page.includes('/students/register') &&
        !page.includes('/students/board') &&
        !page.includes('/students/creator') &&
        !page.includes('/admissions/survey'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
