import { test, expect } from './fixtures/wallet';
import path from 'path';
import fs from 'fs';

test.describe('WOW-1: Freysa Arena Live Attack & Stage Invariants', () => {
  test.beforeEach(async ({ page }) => {
    // These assertions check Vietnamese UI copy: pin the UI language to Vietnamese (lib/i18n.tsx reads missionpay_lang from localStorage)
    await page.addInitScript(() => localStorage.setItem('missionpay_lang', 'vi'));
  });

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
    await expect(page.getByText(/RECIPIENT_NOT_ALLOWLISTED|RECIPIENT_UNTRUSTED_PROVENANCE/).first()).toBeVisible();

    // Save screenshot of mobile view
    const mobileScreenshotPath = path.resolve(process.cwd(), 'evidence/wow-arena-mobile.png');
    await page.screenshot({ path: mobileScreenshotPath, fullPage: true });

    // 5. Navigate to /arena/stage
    await page.goto('/arena/stage');
    await expect(page.locator('h1')).toContainText('FREYSA ARENA');
    await expect(page.locator('text=Đòn tấn công từ khán giả')).toBeVisible();
    await expect(page.getByText('Agent bị thuyết phục', { exact: true })).toBeVisible();
    await expect(page.locator('text=Tiền ra ngoài phạm vi cho phép')).toBeVisible();
    await expect(page.locator('text=$0.00').first()).toBeVisible();

    // Verify live feed has the attack
    await expect(page.getByText(/CHẶN BỞI (RECIPIENT_NOT_ALLOWLISTED|RECIPIENT_UNTRUSTED_PROVENANCE)/).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=LLM THUYẾT PHỤC ✅').first()).toBeVisible();

    // Save screenshot of stage view
    const stageScreenshotPath = path.resolve(process.cwd(), 'evidence/wow-arena-stage.png');
    await page.screenshot({ path: stageScreenshotPath, fullPage: true });
    console.log(`Saved screenshots to: ${mobileScreenshotPath} and ${stageScreenshotPath}`);
  });

  test('WOW-W5: Submits tainted web attack, displays Provenance Trace causal path, verifies Live Fuji Balances on Stage, and captures arena-trace.png', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });

    // 1. Visit /arena
    await page.goto('/arena');

    // 2. Select Zscaler preset
    const zscalerBtn = page.locator('text=Zscaler 7/2026: License $3 ẩn trong JSON-LD');
    await zscalerBtn.click();

    // 3. Submit attack
    const submitBtn = page.locator('button:has-text("BẮN ĐÒN TẤN CÔNG VÀO AGENT")');
    await submitBtn.click();

    // 4. Verify Provenance Trace flow
    await expect(page.locator('text=Đường Đi Dữ Liệu Bẩn (Provenance Trace)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=ĐÃ CHẶN NGUỒN GỐC BẨN')).toBeVisible();

    // 5. Navigate to /arena/stage
    await page.goto('/arena/stage');
    await expect(page.locator('text=LIVE FUJI · block #')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Treasury (0x2045...):')).toBeVisible();
    await expect(page.locator('text=Chi ngoài payee set:')).toBeVisible();

    // Verify stage feed renders Provenance Trace and clean unescaped text (W5-F2, W5-F3)
    await expect(page.locator('text=Đường Đi Dữ Liệu Bẩn (Provenance Trace)').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=ĐÃ CHẶN NGUỒN GỐC BẨN').first()).toBeVisible();
    await expect(page.locator('text=&lt;').first()).not.toBeVisible();

    // 6. Capture deck-shots/arena-trace.png
    const deckShotsDir = path.resolve(process.cwd(), '../../artifacts/submission-s1/deck-shots');
    if (!fs.existsSync(deckShotsDir)) {
      fs.mkdirSync(deckShotsDir, { recursive: true });
    }
    const traceShotPath = path.join(deckShotsDir, 'arena-trace.png');
    await page.screenshot({ path: traceShotPath, fullPage: false });
    console.log(`[WOW-W5] Captured deck shot: ${traceShotPath}`);
    expect(fs.existsSync(traceShotPath)).toBe(true);
  });
});
