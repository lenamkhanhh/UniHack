import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: 'node',
    env: {
      PAYMENT_MODE: 'MOCK',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: [...defaultExclude, 'e2e/**', '**/e2e/**'],
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
