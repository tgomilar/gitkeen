import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { gitApiPlugin } from './server/vite-plugin-git.mjs';

export default defineConfig({
  plugins: [svelte(), gitApiPlugin()],
  server: { port: 5183, strictPort: false }
});
