import { defineConfig } from 'vite';

// BASE_URL lets the GitHub Pages workflow set the subpath (e.g. /called-to-serve/).
// Locally, default to '/'.
export default defineConfig({
  base: process.env.BASE_URL || '/',
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
});
