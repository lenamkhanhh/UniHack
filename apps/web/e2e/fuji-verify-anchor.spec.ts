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

    // Verify main page elements
    await expect(page.locator('h1')).toContainText('ĐỪNG TIN CHÚNG TÔI — TỰ KIỂM CHỨNG');
    await expect(page.locator('text=MỌI BẢN GHI KHỚP TUYỆT ĐỐI')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=✅ CHUỖI TOÀN VẸN 100%')).toBeVisible();
    await expect(page.locator('text=Đã neo on-chain (Fuji)')).toBeVisible();

    // Verify absence of NaN
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('NaN');
    expect(pageText).not.toContain('$NaN');

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
