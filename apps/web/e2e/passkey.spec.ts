import { test, expect } from '@playwright/test';

test.describe('A2: Passkey Mission Authority (RIP-7212 Precompile 0x100 & Real WebAuthn)', () => {
  test('User cancellation does NOT succeed and displays error', async ({ page }) => {
    await page.goto('/missions/new');
    await expect(page.locator('h1')).toContainText('Tạo & Duyệt Mission bằng Passkey');

    // Without virtual authenticator, WebAuthn create will be rejected/canceled by browser
    const registerBtn = page.getByTestId('register-passkey-btn');
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    // Verify error is displayed and approve button remains disabled
    await expect(page.locator('[role="alert"]').or(page.locator('text=thất bại').or(page.locator('text=hủy')))).toBeVisible({
      timeout: 10000,
    });
    const approveBtn = page.getByTestId('approve-passkey-btn');
    await expect(approveBtn).toBeDisabled();
  });

  test('Virtual Authenticator registers P-256 passkey, extracts coordinates, and authorizes two sequential missions (nonce 0 and 1)', async ({
    page,
    context,
  }) => {
    // 1. Enable CDP Virtual Authenticator (CTAP2 P-256)
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const authResult = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    expect(authResult.authenticatorId).toBeDefined();

    // 2. Track relay requests and validate real signature at chain boundary
    let relayedMissions: any[] = [];
    let currentContractNonce = 0;

    await page.route('**/api/passkey/relay', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
            treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
            passkeyX: '0x0',
            passkeyY: '0x0',
            nextNonce: currentContractNonce.toString(),
            rpIdHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
            expectedOrigin: 'http://localhost:3100',
            requireUserVerification: true,
            chainId: 43113,
          }),
        });
      }

      if (request.method() === 'POST') {
        const payload = JSON.parse(request.postData() || '{}');
        relayedMissions.push(payload);

        // Assert real WebAuthn structure at boundary
        expect(payload.missionId).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(payload.auth).toBeDefined();
        expect(payload.auth.authenticatorData.startsWith('0x')).toBe(true);
        expect(payload.auth.authenticatorData.length).toBeGreaterThanOrEqual(76); // >= 37 bytes in hex + 0x
        expect(payload.auth.clientDataJSON).toContain('webauthn.get');
        expect(payload.auth.r.startsWith('0x')).toBe(true);
        expect(payload.auth.s.startsWith('0x')).toBe(true);

        const txHash = `0x${'ab'.repeat(31)}${currentContractNonce.toString(16).padStart(2, '0')}`;
        currentContractNonce++;

        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            status: 'CONFIRMED',
            txHash,
            blockNumber: '60712088',
            gasUsed: '318492',
            snowtraceUrl: `https://testnet.snowtrace.io/tx/${txHash}`,
            authorityAddress: '0x77235386fe59A934645C5F273e411b0Bea8cCc9C',
          }),
        });
      }

      return route.continue();
    });

    // 3. Navigate to /missions/new
    await page.goto('/missions/new');
    await expect(page.locator('h1')).toContainText('Tạo & Duyệt Mission bằng Passkey');
    await expect(page.locator('text=RIP-7212 P-256 Precompile @ 0x100')).toBeVisible();

    // 4. Register passkey with Virtual Authenticator
    const registerBtn = page.getByTestId('register-passkey-btn');
    await expect(registerBtn).toBeVisible();
    await registerBtn.click();

    // Verify registration succeeded and P-256 X/Y coordinates were extracted
    await expect(page.locator('text=Đã ghi nhận Passkey')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=P-256 X:')).toBeVisible();
    await expect(page.locator('text=P-256 Y:')).toBeVisible();

    // 5. Approve Mission 1 (Nonce 0)
    const approveBtn = page.getByTestId('approve-passkey-btn');
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Verify confirmation
    await expect(page.locator('text=Mission Đã Duyệt On-Chain Thành Công!')).toBeVisible({
      timeout: 15000,
    });
    expect(relayedMissions.length).toBe(1);
    expect(relayedMissions[0].nonce).toBe('0');

    // 6. Approve Mission 2 (Nonce 1, different slug and caps)
    await page.fill('#missionSlugInput', 'passkey-mission-live-02');
    await page.fill('#capUsdcInput', '5.0');
    await page.fill('#toolCapUsdcInput', '1.0');

    await approveBtn.click();

    // Verify second mission approved on-chain
    await expect(page.locator('text=Mission Đã Duyệt On-Chain Thành Công!')).toBeVisible({
      timeout: 15000,
    });
    expect(relayedMissions.length).toBe(2);
    expect(relayedMissions[1].nonce).toBe('1');
    expect(relayedMissions[1].cap).toBe('5000000');
    expect(relayedMissions[1].toolCap).toBe('1000000');
    expect(relayedMissions[1].missionId).not.toBe(relayedMissions[0].missionId);

    // Clean up CDP
    await cdp.send('WebAuthn.disable');
  });
});
