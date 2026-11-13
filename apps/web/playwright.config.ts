import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Browser Testing Configuration for UniHack Stage S1.
 * Tests Web3 wallet injection, interactive demo flow, UI state assertions, and public/private boundaries.
 * Separates UI-Mocked tests (browser + Next server) from Real Integration tests (browser + Next server + test DB).
 * See: https://playwright.dev/docs/test-configuration
 */

// E2E always runs against the dedicated test DB. Set it here so BOTH the runner (Prisma would
// otherwise auto-load apps/web/.env = dev DB) and the web server use the same database.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test';
process.env.DATABASE_URL = TEST_DB_URL;
process.env.DIRECT_URL = TEST_DB_URL;

const TEST_PORT = process.env.PLAYWRIGHT_TEST_PORT || '3100';
const TEST_BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://localhost:${TEST_PORT}`;
const isNoWebServer = process.env.NO_WEBSERVER === 'true' || process.env.NO_WEBSERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'playwright-report/test-results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: TEST_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ui-mocked',
      testIgnore: [/.*real-integration\.spec\.ts/, /.*record-demo\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'real-integration',
      testMatch: /.*real-integration\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'video',
      testMatch: /.*record-demo\.spec\.ts/,
      timeout: 180000,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        video: {
          mode: 'on',
          size: { width: 1920, height: 1080 },
        },
        launchOptions: {
          slowMo: 300,
        },
      },
    },
  ],
  webServer: isNoWebServer
    ? undefined
    : {
        command: `npm run dev -- -p ${TEST_PORT}`,
        url: `${TEST_BASE_URL}/demo`,
        reuseExistingServer: false,
        timeout: 120000,
        env: {
          PAYMENT_MODE: 'LIVE_FUJI',
          // The E2E runner seeds rows through lib/db (test DB); the server must read the same test DB,
          // never the dev DB from .env.
          DATABASE_URL: TEST_DB_URL,
          DIRECT_URL: TEST_DB_URL,
          // Test-only presenter key (same literal the specs send) so /api/arena/stats reset works on the
          // throwaway test server; without it reset is disabled by design (WOW-F13) and the per-IP
          // rate limit / counters leak between tests.
          ARENA_PRESENTER_KEY: 'stage-presenter-unihack-key-2026',
        },
      },
});
