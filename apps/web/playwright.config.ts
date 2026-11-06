import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Browser Testing Configuration for UniHack Stage S1.
 * Tests Web3 wallet injection, interactive demo flow, UI state assertions, and public/private boundaries.
 * Separates UI-Mocked tests (browser + Next server) from Real Integration tests (browser + Next server + test DB).
 * See: https://playwright.dev/docs/test-configuration
 */

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
      testIgnore: /.*real-integration\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'real-integration',
      testMatch: /.*real-integration\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isNoWebServer
    ? undefined
    : {
        command: `npm run dev -- -p ${TEST_PORT}`,
        url: `${TEST_BASE_URL}/demo`,
        reuseExistingServer: false,
        timeout: 120000,
      },
});
