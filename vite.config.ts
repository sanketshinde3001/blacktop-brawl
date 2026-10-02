import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { GAME_TITLE } from './src/config';

/** "BLACKTOP BRAWL" -> "Blacktop Brawl" for the page title */
const pageTitle = GAME_TITLE.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // relative asset paths: the build runs from any folder or sub-path (itch.io, GitHub Pages, S3, …)
  base: './',
  plugins: [{ name: 'game-title', transformIndexHtml: (html) => html.replaceAll('%GAME_TITLE%', pageTitle) }],
  server: { port: 5173, open: false },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
