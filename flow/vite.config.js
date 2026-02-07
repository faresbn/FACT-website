import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  // Use '/' in dev for simplicity, '/flow/' in production
  base: mode === 'production' ? '/flow/' : '/',
  plugins: [
    tailwindcss(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      input: 'flow.html',
    },
  },
  server: {
    port: 5173,
    open: true
  }
}));
