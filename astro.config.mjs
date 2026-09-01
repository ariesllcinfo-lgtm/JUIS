import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://www.juis.example',
  output: 'static',
  vite: {
    plugins: [tailwindcss()]
  }
});
