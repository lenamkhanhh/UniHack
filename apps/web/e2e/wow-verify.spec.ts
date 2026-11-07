import { test, expect } from './fixtures/wallet';
import path from 'path';

test.describe('WOW-2: Client-Side Hash Chain Verifier & Tamper Simulation', () => {
  test('Browser verifies hash-chain integrity, simulates 1-byte tamper, and cascades detection', async ({ page }) => {
    test.setTimeout(60000);

    // 1. Visit /verify/demo-seed (WOW-F2)
    await page.goto('/verify/demo-seed');
    await expect(page.locator('h1')).toContainText('ĐỪNG TIN CHÚNG TÔI — TỰ KIỂM CHỨNG');

    // Verify DEMO SEED banner is visible on demo-seed route
    const seedBanner = page.locator('[data-testid="demo-seed-banner"]');
    await expect(seedBanner).toBeVisible({ timeout: 10000 });
    await expect(seedBanner).toContainText('DEMO SEED — KHÔNG PHẢI GIAO DỊCH THẬT');

    // 2. Verify initial pristine state (green)
    await expect(page.locator('text=CHUỖI TOÀN VẸN 100%')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=MỌI BẢN GHI KHỚP TUYỆT ĐỐI')).toBeVisible();
    await expect(page.locator('text=Block #0')).toBeVisible();
    await expect(page.locator('text=Block #1')).toBeVisible();

    // Capture screenshot of verified original chain
    const originalScreenshotPath = path.resolve(process.cwd(), 'evidence/wow-verify-original.png');
    await page.screenshot({ path: originalScreenshotPath, fullPage: true });

    // 3. Click "Thử sửa 1 byte dữ liệu"
    const tamperBtn = page.locator('[data-testid="tamper-one-byte-btn"]');
    await expect(tamperBtn).toBeVisible({ timeout: 10000 });
    await tamperBtn.click({ force: true });

    // 4. Verify tampering detected immediately in browser
    await expect(page.locator('text=CHUỖI BỊ GÃY / GIAN LẬN')).toBeVisible();
    await expect(page.locator('text=PHÁT HIỆN SAI LỆCH MÃ HASH')).toBeVisible();
    await expect(page.locator('text=ĐÃ BỊ SỬA ĐỔI')).toBeVisible();
    await expect(page.locator('text=Chi tiết phát hiện gian lận:')).toBeVisible();

    // Capture screenshot of broken/tampered chain
    const tamperedScreenshotPath = path.resolve(process.cwd(), 'evidence/wow-verify-tampered.png');
    await page.screenshot({ path: tamperedScreenshotPath, fullPage: true });

    // 5. Click "Khôi phục nguyên gốc"
    const resetBtn = page.locator('[data-testid="reset-original-btn"]');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click({ force: true });

    // 6. Verify pristine restoration
    await expect(page.locator('text=CHUỖI TOÀN VẸN 100%')).toBeVisible();
    console.log(`Saved screenshots to: ${originalScreenshotPath} and ${tamperedScreenshotPath}`);
  });
});
