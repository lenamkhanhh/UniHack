import { test, expect } from './fixtures/wallet';

test.describe('E2E Browser Workflow: Mission Lifecycle & Interactive Demo', () => {
  test('Renders interactive demo UI with initial idle states and connects mock wallet', async ({ page, wallet }) => {
    // Intercept initial policy fetch so page render doesn't receive HTTP 500 when DB is unavailable
    await page.route('/api/policy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stage: 'S1',
          chainId: 43113,
          paymentMode: 'MOCK',
          systemPaused: false,
          maintenance: false,
          deploymentId: 'unihack-s1-test',
          configuredOwner: wallet.ownerAddress,
        }),
      });
    });

    await wallet.injectMockWallet(page);

    await page.goto('/demo');

    // 1. Verify Page Titles and Badges
    await expect(page.locator('h1')).toHaveText('Interactive S1 Production Demo');
    await expect(page.locator('text=Interactive S1 Production Demo')).toBeVisible();

    // Verify badges
    const paymentModeBadge = page.locator('text=/Payment Mode: .*/');
    await expect(paymentModeBadge).toBeVisible();

    const stageBadge = page.locator('text=/Stage: .*/');
    await expect(stageBadge).toBeVisible();

    // 2. Initial Wallet State
    const connectButton = page.locator('button:has-text("Connect MetaMask")');
    await expect(connectButton).toBeVisible();
    await expect(page.locator('text=MetaMask required for browser owner signing')).toBeVisible();

    // 3. Connect Wallet Action
    await connectButton.click();

    // Verify Connected Wallet State
    const connectedBadge = page.locator(`button:has-text("Connected: ${wallet.ownerAddress.slice(0, 6)}")`);
    await expect(connectedBadge).toBeVisible();
    await expect(page.locator('text=Signing via personal_sign')).toBeVisible();

    // 4. Verify 8 Step Pills are present in IDLE state using scoped testids
    const stepIds = [
      'policy',
      'challenge',
      'create',
      'activate',
      'search',
      'talkmeter',
      'complete',
      'proof',
    ];

    for (const stepId of stepIds) {
      const stepLocator = page.locator(`[data-testid="step-${stepId}"]`);
      await expect(stepLocator).toBeVisible();
      await expect(stepLocator).toHaveAttribute('data-status', 'IDLE');
      await expect(stepLocator).toHaveText(/IDLE/);
    }

    // 5. Verify execute button is enabled
    const executeButton = page.locator('button:has-text("Execute Live S1 Flow")');
    await expect(executeButton).toBeVisible();
    await expect(executeButton).toBeEnabled();
  });

  test('Executes end-to-end interactive demo flow with mock network interception', async ({ page, wallet }) => {
    await wallet.injectMockWallet(page);

    const testSlug = 'demo-mock-e2e-123456';
    const testMissionId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    // Intercept API routes to verify full UI state progression in test environment
    await page.route('/api/policy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stage: 'S1',
          chainId: 43113,
          paymentMode: 'MOCK',
          systemPaused: false,
          maintenance: false,
          deploymentId: 'unihack-s1-deployment',
          configuredOwner: wallet.ownerAddress,
          agentAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        }),
      });
    });

    await page.route('/api/auth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nonce: 'mock-nonce-11112222333344445555666677778888',
          message: 'UniHack Authorization Challenge\nAction: TEST',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
      });
    });

    await page.route('/api/missions', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            mission: {
              slug: testSlug,
              missionId: testMissionId,
              status: 'ACTIVE',
              toolCap: '5000000',
              policyHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/activate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          spendToken: 'mock-spend-jwt-token-for-e2e-testing',
        }),
      });
    });

    await page.route('/api/tools/orchestrate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'SETTLED',
          result: { answer: 'Mock search result for Avalanche Fuji x402 payment' },
          operation: { state: 'SETTLED' },
        }),
      });
    });

    await page.route('/api/tools/talkmeter/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { id: 'mock-session-uuid-1234', status: 'ACTIVE' },
        }),
      });
    });

    await page.route('/api/tools/talkmeter/tick', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          minuteIndex: 0,
          operation: { state: 'SETTLED' },
        }),
      });
    });

    await page.route('/api/tools/talkmeter/stop', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: { status: 'STOPPED' },
        }),
      });
    });

    await page.route('**/complete', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mission: { status: 'COMPLETED' },
        }),
      });
    });

    await page.route('**/proof*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ledgerScope: 'mission',
          audit: {
            entries: [{ id: '1', kind: 'TOOL_PAID' }],
            checkpoint: { headHash: '0x11112222333344445555666677778888', entryCount: 1 },
          },
        }),
      });
    });

    await page.route('/api/audit', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bundles: [], unprojectedLegacyEntries: 0 }),
      });
    });

    await page.goto('/demo');

    // Connect wallet
    await page.locator('button:has-text("Connect MetaMask")').click();
    await expect(page.locator('text=Connected: 0x')).toBeVisible();

    // Click Execute
    const executeBtn = page.locator('button:has-text("Execute Live S1 Flow")');
    await executeBtn.click();

    // Verify all steps transition to SUCCESS using scoped testids
    const stepIds = [
      'policy',
      'challenge',
      'create',
      'activate',
      'search',
      'talkmeter',
      'complete',
      'proof',
    ];

    for (const stepId of stepIds) {
      const stepCard = page.locator(`[data-testid="step-${stepId}"]`);
      await expect(stepCard).toBeVisible({ timeout: 10000 });
      await expect(stepCard).toHaveAttribute('data-status', 'SUCCESS');
      await expect(stepCard).toHaveText(/SUCCESS/);
    }

    // Verify success log banner
    await expect(page.locator('text=SUCCESS: Complete vertical S1 mission lifecycle executed and verified against live API routes.')).toBeVisible();
  });
});
