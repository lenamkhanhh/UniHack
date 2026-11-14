import { test, expect } from './fixtures/wallet';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

test.describe('S1-F7: Avalanche Fuji Verified Anchor Evidence Screenshot', () => {
  test.use({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const repoRoot = path.resolve(__dirname, '../../..');
  const deckShotsDir = path.resolve(repoRoot, 'artifacts/submission-s1/deck-shots');
  const webEvidenceDir = path.resolve(__dirname, '../evidence');

  test.beforeAll(async () => {
    // Seed the REAL Fuji mission fuji-live-mission-s1c (run 13/11/2026) via hermetic standalone script
    const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test';
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execSync(`${npxCmd} tsx scripts/seed-mission-audit.ts --slug fuji-live-mission-s1c`, {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: dbUrl,
        DIRECT_URL: dbUrl,
      },
      stdio: 'pipe',
    });
  });

  test.beforeEach(async ({ page }) => {
    // Pin UI language to English (lib/i18n.tsx reads missionpay_lang from localStorage)
    await page.addInitScript(() => localStorage.setItem('missionpay_lang', 'en'));
    // Hide dev overlay indicators completely
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

  test('Captures fuji-verify-anchor.png proving on-chain anchor matches client verification', async ({ page }) => {
    await page.goto('/verify/fuji-live-mission-s1c');

    // S1-F10: Assert layout header reflects LIVE_FUJI and STAGE S2
    await expect(page.locator('header')).toContainText('LIVE_FUJI');
    await expect(page.locator('header')).toContainText('S2');

    // Verify main page elements
    await expect(page.locator('h1')).toContainText("DON'T TRUST US — VERIFY YOURSELF");
    await expect(page.locator('text=ALL ENTRIES MATCH CRYPTOGRAPHICALLY')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=HASH CHAIN VALID')).toBeVisible();

    // S1-F9 & S1-F10: Assert on-chain anchor badge and "MATCH" label
    await expect(page.locator('[data-testid="anchor-status-badge"]')).toContainText('Anchored on Avalanche Fuji');
    await expect(page.locator('[data-testid="anchor-match-badge"]')).toHaveText('MATCH');

    // S1-F10: Assert client head equals on-chain anchored head
    const onchainHeadEl = page.locator('[data-testid="onchain-head"]');
    await expect(onchainHeadEl).toBeVisible();
    const onchainHeadText = (await onchainHeadEl.textContent()) || '';
    expect(onchainHeadText.startsWith('0x')).toBe(true);

    const clientHeadEl = page.locator('[data-testid="client-head"]');
    await expect(clientHeadEl).toBeVisible();
    const clientHeadText = (await clientHeadEl.textContent()) || '';
    expect(clientHeadText.toLowerCase()).toBe(onchainHeadText.toLowerCase());

    // Verify absence of NaN
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('NaN');
    expect(pageText).not.toContain('$NaN');

    // Verify interactive tamper behavior
    await page.locator('[data-testid="tamper-one-byte-btn"]').click();
    await expect(page.locator('[data-testid="anchor-mismatch-badge"]')).toHaveText('MISMATCH');
    await expect(page.locator('text=HASH CHAIN CORRUPTION DETECTED')).toBeVisible();

    // Restore original state before screenshot
    await page.locator('[data-testid="reset-original-btn"]').click();
    await expect(page.locator('[data-testid="anchor-match-badge"]')).toHaveText('MATCH');
    await expect(page.locator('text=ALL ENTRIES MATCH CRYPTOGRAPHICALLY')).toBeVisible();

    // Wait for QR code to render completely
    await page.waitForTimeout(2000);

    if (!fs.existsSync(deckShotsDir)) {
      fs.mkdirSync(deckShotsDir, { recursive: true });
    }
    if (!fs.existsSync(webEvidenceDir)) {
      fs.mkdirSync(webEvidenceDir, { recursive: true });
    }

    const shot1 = path.join(deckShotsDir, 'fuji-verify-anchor.png');
    const shot2 = path.join(webEvidenceDir, 'fuji-verify-anchor.png');

    await page.screenshot({ path: shot1, fullPage: false });
    await page.screenshot({ path: shot2, fullPage: false });

    console.log(`Saved fuji-verify-anchor.png to ${shot1} and ${shot2}`);
  });
});
