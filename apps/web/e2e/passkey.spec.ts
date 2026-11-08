import { test, expect } from '@playwright/test';

test.describe('WOW-W4: Passkey Mission Authority (RIP-7212 Precompile 0x100)', () => {
  test('WebAuthn Virtual Authenticator registers and approves mission via relayer', async ({ page, context }) => {
    // 1. Enable CDP Virtual Authenticator
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    // 2. Navigate to /missions/new
    await page.goto('/missions/new');

    // Check page title and RIP-7212 badge
    await expect(page.locator('h1')).toContainText('Tạo & Duyệt Mission bằng Passkey');
    await expect(page.locator('text=RIP-7212 P-256 Precompile @ 0x100')).toBeVisible();

    // 3. Register passkey
    const registerBtn = page.getByTestId('register-passkey-btn');
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    // Verify registration status
    await expect(page.locator('text=thành công').or(page.locator('text=Đã ghi nhận Passkey'))).toBeVisible({
      timeout: 10000,
    });

    // 4. Click approve by passkey
    const approveBtn = page.getByTestId('approve-passkey-btn');
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // 5. Verify success card and on-chain metrics
    await expect(page.locator('text=Mission Đã Duyệt On-Chain Thành Công!')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('text=RIP-7212 Native')).toBeVisible();

    // 6. Capture screenshot for pitch deck
    const fs = await import('fs');
    const path = await import('path');
    const deckShotsDir = path.resolve(process.cwd(), '../../artifacts/submission-s1/deck-shots');
    if (!fs.existsSync(deckShotsDir)) {
      fs.mkdirSync(deckShotsDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(deckShotsDir, 'wow-w4-passkey.png'),
      fullPage: true,
    });

    // Clean up CDP
    await cdp.send('WebAuthn.disable');
  });
});
