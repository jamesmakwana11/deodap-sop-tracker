import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const SNAPSHOT = fileURLToPath(new URL('./src/preview/snapshot.json', import.meta.url));

export default defineConfig(({ mode }) => {
  // The demo build runs on a snapshot of DEVELOPMENT sample data, generated locally and never committed.
  if (mode === 'preview' && !existsSync(SNAPSHOT)) {
    throw new Error(
      'The preview build needs client/src/preview/snapshot.json, made from development sample data:\n' +
        '  npm run db:seed:dev && npm run preview:snapshot --workspace server\n' +
        'The production build (npm run build) does not need it.',
    );
  }
  return {
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
  };
});
