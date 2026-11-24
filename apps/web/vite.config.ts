import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Em dev o painel roda na 5173 e repassa /api e /ws para o servidor (3000).
const API = process.env.API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: false, secure: false },
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true, secure: false },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        overlay: resolve(import.meta.dirname, 'overlay.html'),
      },
    },
  },
});
