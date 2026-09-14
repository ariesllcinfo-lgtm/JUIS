import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://juis-ac.jp',
  output: 'static',
  vite: {
    plugins: [tailwindcss()]
  }
});
