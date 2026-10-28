import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => ({
  // `vite build --mode pages`: static GitHub Pages build served from /<repo>/ (override with VITE_BASE).
  base: mode === 'pages' ? process.env.VITE_BASE || '/spotleHungary/' : '/',
  plugins: [
    react(),
    {
      // Serve the admin portal at /admin in development (production: Express serves dist/admin.html).
      name: 'admin-route',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html';
          next();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      // The admin portal needs the Express API, so it is left out of the static GitHub Pages build.
      input: {
        main: resolve(__dirname, 'index.html'),
        ...(mode === 'pages' ? {} : { admin: resolve(__dirname, 'admin.html') }),
      } as Record<string, string>,
    },
  },
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
