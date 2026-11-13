import { defineConfig, defaultExclude } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: 'node',
    env: {
      PAYMENT_MODE: 'MOCK',
      // Tests always use the dedicated test DB (wiped by tests/setup.ts clearDatabase), never the dev DB in .env.
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test',
      DIRECT_URL: process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test',
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
