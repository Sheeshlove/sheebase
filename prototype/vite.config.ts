import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    proxy: {
      // со слешем: иначе под прокси попадает модуль /api.ts
      '/api/': `http://localhost:${API_PORT}`,
      '^/ws$': { target: `ws://localhost:${API_PORT}`, ws: true },
    },
  },
});
