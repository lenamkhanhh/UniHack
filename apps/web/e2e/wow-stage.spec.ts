import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('WOW-5: Unified Stage Presentation Console', () => {
  test('Console switches scenes 1-5 via keyboard shortcuts and UI buttons, executes seed mode, and captures wow-stage-console screenshot', async ({ page }) => {
    // 1. Navigate to /stage and wait for client hydration
    await page.goto('/stage', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible({ timeout: 10000 });

    // Scene 1: Hook ($174,000 · 5/2026)
    const scene1 = page.locator('[data-testid="scene-1-container"]');
    await expect(scene1).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=$174,000')).toBeVisible();

    // 2. Click button "2. 0:15 Bankr Replay"
    const btnScene2 = page.locator('[data-testid="scene-btn-2"]');
    await btnScene2.click();
    const scene2 = page.locator('[data-testid="scene-2-container"]');
    await expect(scene2).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=REPLAY VỤ BANKR $170K TRONG 30 GIÂY')).toBeVisible();

    // 3. Click button "3. 1:00 Arena QR"
    const btnScene3 = page.locator('[data-testid="scene-btn-3"]');
    await btnScene3.click();
    const scene3 = page.locator('[data-testid="scene-3-container"]');
    await expect(scene3).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=THỬ LỪA AGENT NÀY XEM')).toBeVisible();
    await expect(page.locator('text=Đòn Tấn Công Của Khán Giả')).toBeVisible();

    // 4. Click button "4. 1:30 Money Flow"
    const btnScene4 = page.locator('[data-testid="scene-btn-4"]');
    await btnScene4.click();
    const scene4 = page.locator('[data-testid="scene-4-container"]');
    await expect(scene4).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=LIVING MONEY FLOW — LIÊN KẾT AUDIT LEDGER')).toBeVisible();

    // 5. Click button "5. 2:40 Punchline"
    const btnScene5 = page.locator('[data-testid="scene-btn-5"]');
    await btnScene5.click();
    const scene5 = page.locator('[data-testid="scene-5-container"]');
    await expect(scene5).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=LLM CÓ THỂ BỊ LỪA.')).toBeVisible();
    await expect(page.locator('text=NGÂN SÁCH TRÊN AVALANCHE THÌ KHÔNG.')).toBeVisible();

    // 6. Test Keyboard shortcut: focus body and press '1' to return to Hook
    await page.locator('body').click();
    await page.keyboard.press('1');
    await expect(scene1).toBeVisible({ timeout: 5000 });

    // 7. Test Seed Mode toggle
    const seedToggleBtn = page.locator('[data-testid="toggle-seed-mode-btn"]');
    await expect(seedToggleBtn).toBeVisible();
    await seedToggleBtn.click();
    await expect(seedToggleBtn).toContainText('DEMO SEED');

    // 8. Go to Scene 2 and capture evidence screenshot
    await btnScene2.click();
    await expect(scene2).toBeVisible({ timeout: 5000 });

    const screenshotPath = path.resolve(__dirname, '../evidence/wow-stage-console.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Saved screenshot to:', screenshotPath);
  });
});
