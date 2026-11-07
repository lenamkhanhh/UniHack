import { test, expect } from './fixtures/wallet';
import path from 'path';
import fs from 'fs';

test.describe('S1-F7: Avalanche Fuji Verified Anchor Evidence Screenshot', () => {
  test.use({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const deckShotsDir = path.resolve(process.cwd(), '../../artifacts/submission-s1/deck-shots');
  const webEvidenceDir = path.resolve(process.cwd(), 'evidence');

  test.beforeEach(async ({ page }) => {
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
    await page.goto('/verify/fuji-live-mission-s1b');

    // S1-F10: Assert layout header reflects LIVE_FUJI and STAGE S2
    await expect(page.locator('header')).toContainText('MODE: LIVE_FUJI');
    await expect(page.locator('header')).toContainText('STAGE: S2');

    // Verify main page elements
    await expect(page.locator('h1')).toContainText('ĐỪNG TIN CHÚNG TÔI — TỰ KIỂM CHỨNG');
    await expect(page.locator('text=MỌI BẢN GHI KHỚP TUYỆT ĐỐI')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=✅ CHUỖI TOÀN VẸN 100%')).toBeVisible();

    // S1-F9 & S1-F10: Assert on-chain anchor badge and "khớp" label
    await expect(page.locator('[data-testid="anchor-status-badge"]')).toContainText('Đã neo on-chain (Fuji)');
    await expect(page.locator('[data-testid="anchor-match-badge"]')).toHaveText('khớp');

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
    await expect(page.locator('[data-testid="anchor-mismatch-badge"]')).toHaveText('không khớp');
    await expect(page.locator('text=PHÁT HIỆN SAI LỆCH MÃ HASH')).toBeVisible();

    // Restore original state before screenshot
    await page.locator('[data-testid="reset-original-btn"]').click();
    await expect(page.locator('[data-testid="anchor-match-badge"]')).toHaveText('khớp');
    await expect(page.locator('text=MỌI BẢN GHI KHỚP TUYỆT ĐỐI')).toBeVisible();

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
