import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // `vite build --mode pages`: static GitHub Pages build served from /<repo>/ (override with VITE_BASE).
  base: mode === 'pages' ? process.env.VITE_BASE || '/spotleHungary/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  test: {
    environment: 'node',
  },
}));
