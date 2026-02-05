import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Use '/' in dev for simplicity, '/flow/' in production
  base: mode === 'production' ? '/flow/' : '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets'
  },
  server: {
    port: 5173,
    open: true
  }
}));
