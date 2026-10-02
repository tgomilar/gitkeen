// The Gitkeen website: the landing page and the pages in ../docs, published
// on GitHub Pages at https://tgomilar.github.io/gitkeen/.
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';
import { rewriteDocLinks } from './src/lib/rewrite-doc-links.mjs';

const base = '/gitkeen';

export default defineConfig({
  site: 'https://tgomilar.github.io',
  base,
  trailingSlash: 'always',
  // Compressing the HTML drops the space between a line of text and a link
  // that starts on the next line, so "the MIT licence" became "theMIT licence".
  compressHTML: false,
  // The sitemap lists every page for search engines. Submit sitemap-index.xml
  // in Google Search Console.
  integrations: [svelte(), sitemap()],
  markdown: {
    remarkPlugins: [[rewriteDocLinks, { base }]],
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
