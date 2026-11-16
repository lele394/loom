import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/db/migrations/**'],
      reporter: ['text-summary'],
    },
  },
});
