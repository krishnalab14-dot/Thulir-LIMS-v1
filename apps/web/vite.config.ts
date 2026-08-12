import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app talks to the API through a relative /api base URL. In dev the
// Vite dev server proxies /api to the NestJS API (override with
// VITE_API_PROXY_TARGET); in the Docker/nginx build the proxy is handled by
// nginx.conf. The production API base can be overridden with VITE_API_URL at
// build time if the app is ever served from a different origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    hmr: false,
  },
});
