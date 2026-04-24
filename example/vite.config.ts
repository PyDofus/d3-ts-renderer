import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  server: {
    port: 5173,
    host: '0.0.0.0',
    open: '/index.html',
  },
  optimizeDeps: {
    exclude: ['gl', 'sharp'],
  },
});
