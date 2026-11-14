import { test, expect } from './fixtures/wallet';
import path from 'path';

test.describe('WOW-0: Replay Vụ Bankr $174k Incident', () => {
  test.beforeEach(async ({ page }) => {
    // These assertions check Vietnamese UI copy: pin the UI language to Vietnamese (lib/i18n.tsx reads missionpay_lang from localStorage)
    await page.addInitScript(() => localStorage.setItem('missionpay_lang', 'vi'));
  });

  test('User clicks replay button, split-screen displays unguarded $174k drain vs guarded $0.00 loss', async ({ page }) => {
    // 1. Visit /bankr
    await page.goto('/bankr');
    await expect(page.locator('h1')).toContainText('REPLAY VỤ BANKR / GROK');
    await expect(page.locator('text=MÔ PHỎNG — HỆ KHÔNG CÓ GUARD')).toBeVisible();
    await expect(page.locator('text=HỆ THỐNG MISSIONPAY (MÔ PHỎNG SANDBOX)')).toBeVisible();

    // 2. Click Replay button
    const replayBtn = page.locator('[data-testid="run-bankr-replay-btn"]');
    await expect(replayBtn).toBeVisible();
    await replayBtn.click();

    // 3. Verify left panel drops balance to $0.00 and shows drained alert
    await expect(page.locator('text=TOÀN BỘ SỐ DƯ BỊ RÚT SẠCH')).toBeVisible({ timeout: 15000 });

    // 4. Verify right panel shows calibrated off-chain validator defense with $0.00 loss
    await expect(page.locator('text=Tiền đã chuyển: $0.00 — chặn bởi validator (off-chain)')).toBeVisible();
    await expect(page.getByText(/BLOCK \(?(RECIPIENT_NOT_ALLOWLISTED|RECIPIENT_UNTRUSTED_PROVENANCE)\)?/)).toBeVisible();

    // 5. Verify decoded Morse inspector appears
    await expect(page.locator('text=Chuỗi mã Morse ẩn trong tài liệu nguồn:')).toBeVisible();
    await expect(page.locator('text=Dòng lệnh sau khi Agent giải mã thành công:')).toBeVisible();

    // 6. Capture screenshot for WOW-0 evidence
    const screenshotPath = path.resolve(process.cwd(), 'evidence/wow-bankr-replay.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved screenshot to: ${screenshotPath}`);
  });
});
