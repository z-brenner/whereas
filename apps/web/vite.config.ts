import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  // No inlined assets: the server's content policy only allows same-origin files.
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900, assetsInlineLimit: 0 },
});
