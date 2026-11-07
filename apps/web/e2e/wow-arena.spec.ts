import { test, expect } from './fixtures/wallet';
import path from 'path';

test.describe('WOW-1: Freysa Arena Live Attack & Stage Invariants', () => {
  test('Audience submits adversarial attack from mobile arena and stage screen displays real-time block and $0.00 loss', async ({ page, request }) => {
    // 0. Ensure fresh rate limit bucket for isolated test execution
    await request.post('/api/arena/stats', {
      data: { reset: true },
      headers: { 'x-presenter-key': 'stage-presenter-unihack-key-2026' },
    }).catch(() => {});

    // 1. Visit /arena
    await page.goto('/arena');
    await expect(page.locator('h1')).toContainText('Freysa Arena');
    await expect(page.locator('text=Freysa mất $45k vì guard nằm trong LLM')).toBeVisible();

    // 2. Select preset: Morse code attack
    const morseBtn = page.locator('text=Lệnh Morse ẩn (Bankr -$174k)');
    await expect(morseBtn).toBeVisible();
    await morseBtn.click();

    // Verify textarea populated
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveValue(/Mã Morse/);

    // 3. Submit attack
    const submitBtn = page.locator('button:has-text("BẮN ĐÒN TẤN CÔNG VÀO AGENT")');
    await submitBtn.click();

    // 4. Verify Verdict Card appears with real-time defense
    await expect(page.locator('text=BỊ CHẶN (BLOCK)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Chặn bởi validator off-chain')).toBeVisible();
    await expect(page.locator('text=Lớp bảo vệ kích hoạt (Rule ID):')).toBeVisible();
    await expect(page.locator('text=RECIPIENT_NOT_ALLOWLISTED')).toBeVisible();

    // Save screenshot of mobile view
    const mobileScreenshotPath = path.resolve(process.cwd(), 'evidence/wow-arena-mobile.png');
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });

    // 5. Navigate to /arena/stage
    await page.goto('/arena/stage');
    await expect(page.locator('h1')).toContainText('FREYSA ARENA');
    await expect(page.locator('text=Đòn tấn công từ khán giả')).toBeVisible();
    await expect(page.locator('text=Agent bị thuyết phục')).toBeVisible();
    await expect(page.locator('text=Tiền ra ngoài phạm vi cho phép')).toBeVisible();
    await expect(page.locator('text=$0.00').first()).toBeVisible();

    // Verify live feed has the attack
    await expect(page.locator('text=CHẶN BỞI RECIPIENT_NOT_ALLOWLISTED').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=LLM THUYẾT PHỤC ✅').first()).toBeVisible();

    // Save screenshot of stage view
    const stageScreenshotPath = path.resolve(process.cwd(), 'evidence/wow-arena-stage.png');
    await page.screenshot({ path: stageScreenshotPath, fullPage: true });
    console.log(`Saved screenshots to: ${mobileScreenshotPath} and ${stageScreenshotPath}`);
  });
});
