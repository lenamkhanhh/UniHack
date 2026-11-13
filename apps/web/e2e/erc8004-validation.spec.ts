import { test, expect } from './fixtures/wallet';
import path from 'path';
import fs from 'fs';

test.describe('WOW-W2: ERC-8004 Validation Registry on Avalanche Fuji', () => {
  test.use({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const deckShotsDir = path.resolve(process.cwd(), '../../artifacts/submission-s1/deck-shots');

  test.beforeAll(async () => {
    // Seed the REAL Fuji mission fuji-live-mission-s1c (run 13/11/2026) from its committed audit export.
    const { prisma } = await import('../lib/db');
    const { seedMissionAudit } = await import('../../../scripts/lib/mission-audit');
    const doc = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), '../../evidence/missions/fuji-live-mission-s1c/audit.json'), 'utf8'),
    );
    await seedMissionAudit(prisma as any, doc);
  });

  test.beforeEach(async ({ page }) => {
    // Pin UI language to English (lib/i18n.tsx reads missionpay_lang from localStorage)
    await page.addInitScript(() => localStorage.setItem('missionpay_lang', 'en'));
    // Hide dev overlay indicators
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = `
        nextjs-portal,
        #nextjs-dev-indicator,
        [data-nextjs-dev-indicator],
        [data-nextjs-toast-wrapper],
        #__next-build-watcher {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `;
      document.head.appendChild(style);
    });
  });

  test('Validates live ERC-8004 score 100 and validator address from Fuji registry', async ({ page }) => {
    await page.goto('/verify/fuji-live-mission-s1c');

    // Wait for main content to load
    await expect(page.locator('h1')).toContainText("DON'T TRUST US — VERIFY YOURSELF");

    // Assert ERC-8004 Validation card
    const statusBadge = page.locator('[data-testid="erc8004-status-badge"]');
    await expect(statusBadge).toBeVisible({ timeout: 15000 });
    await expect(statusBadge).toContainText('Validation Score: 100/100', { timeout: 15000 });

    const tagBadge = page.locator('[data-testid="erc8004-tag-badge"]');
    await expect(tagBadge).toBeVisible();
    await expect(tagBadge).toHaveText('verified-full');

    const validatorEl = page.locator('[data-testid="erc8004-validator-address"]');
    await expect(validatorEl).toBeVisible();
    await expect(validatorEl).toContainText('0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5');

    const agentIdEl = page.locator('[data-testid="erc8004-agent-id"]');
    await expect(agentIdEl).toBeVisible();
    await expect(agentIdEl).toContainText('#294');

    const txLink = page.locator('[data-testid="erc8004-tx-link"]');
    await expect(txLink).toBeVisible();
    const href = await txLink.getAttribute('href');
    expect(href).toContain('testnet.snowtrace.io/tx/0xa9f7faddb9e15f0efdb94349f49aed63a5af30666a9edeeffbb5fe8814af5ffa');

    // Capture screenshot
    if (!fs.existsSync(deckShotsDir)) {
      fs.mkdirSync(deckShotsDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(deckShotsDir, 'wow-w2-erc8004.png'),
      fullPage: true,
    });
  });
});
