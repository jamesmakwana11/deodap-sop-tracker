import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // `vite build --mode preview` builds a static demo (src/preview) that needs no server.
  ...(mode === 'preview' && {
    base: './',
    build: { outDir: 'dist-preview', rollupOptions: { input: 'preview.html' } },
  }),
  server: {
    port: 5173,
    // The browser only ever talks to /api on its own origin; no Meta credentials reach the client.
    proxy: { '/api': 'http://localhost:4000' },
  },
}));
