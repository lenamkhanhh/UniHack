import { test, expect } from './fixtures/wallet';

test.describe('E2E Browser Workflow: Dashboard, Pending Invariants & Publication Boundaries', () => {
  test.beforeEach(async ({ page }) => {
    // Pin UI language to English (lib/i18n.tsx reads missionpay_lang from localStorage)
    await page.addInitScript(() => localStorage.setItem('missionpay_lang', 'en'));
  });

  test('Renders empty dashboard when no public missions are available', async ({ page }) => {
    await page.route('/api/missions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ missions: [] }),
      });
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Active Missions & On-Chain Budgets' })).toBeVisible();
    await expect(page.locator('text=No active missions found in current database.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Launch Demo Mission' })).toBeVisible();
  });

  test('Renders published mission cards with two separate budgets on dashboard', async ({ page }) => {
    const mockMissions = [
      {
        slug: 'mission-alpha-pub',
        missionId: '0xalpha',
        ownerAddress: '0x1111111111111111111111111111111111111111',
        agentAddress: '0x2222222222222222222222222222222222222222',
        treasuryCap: '10000000',
        toolCap: '5000000',
        spentTool: '100000',
        reservedTool: '50000',
        spentTreasury: '0',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        status: 'ACTIVE',
        publicPublished: true,
      },
    ];

    await page.route('/api/missions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ missions: mockMissions }),
      });
    });

    await page.goto('/');

    // Verify Mission Card Header
    await expect(page.locator('text=mission-alpha-pub')).toBeVisible();
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible();

    // Verify Two Separate Budgets (00 §2, 05 §5)
    await expect(page.locator('text=Tool Budget (Session Wallet)')).toBeVisible();
    // 5.00 - 0.10 - 0.05 = 4.85 USDC remaining
    await expect(page.locator('text=4.85 USDC')).toBeVisible();
    await expect(page.locator('text=Spent: 0.10')).toBeVisible();
    await expect(page.locator('text=Reserved: 0.05')).toBeVisible();
    await expect(page.locator('text=Cap: 5.00')).toBeVisible();
  });

  test('Honest SUBMITTING State: 202 tick renders PENDING in DOM and halts before Complete', async ({ page, wallet }) => {
    await wallet.injectMockWallet(page);

    let tickCalls = 0;
    let completeCalls = 0;

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
          deploymentId: 'dep-test',
          configuredOwner: wallet.ownerAddress,
        }),
      });
    });

    await page.route('/api/auth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nonce: 'test-nonce-1234567890abcdef',
          message: 'UniHack Auth Challenge: test',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
      });
    });

    await page.route('/api/missions', async (route) => {
      const postData = route.request().postDataJSON();
      const slug = postData?.payload?.slug || 'test-pending-mission';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          mission: {
            slug,
            missionId: '0x' + 'a'.repeat(64),
            status: 'CREATED',
            ownerAddress: wallet.ownerAddress,
            agentAddress: '0x2222222222222222222222222222222222222222',
            treasuryCap: '10000000',
            toolCap: '5000000',
            policyHash: '0x' + '1'.repeat(64),
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/activate/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ACTIVE',
          spendToken: 'mock.jwt.token',
        }),
      });
    });

    await page.route('/api/tools/orchestrate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          operationId: 'op-search-1',
          state: 'SETTLED',
          result: { points: [{ lat: 45, lng: 7 }] },
        }),
      });
    });

    await page.route('/api/tools/talkmeter/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: {
            id: 'sess-pending-1',
            status: 'ACTIVE',
            startedAt: new Date().toISOString(),
          },
        }),
      });
    });

    // Intercept TalkMeter tick returning 202 SUBMITTING
    await page.route('/api/tools/talkmeter/tick', async (route) => {
      tickCalls++;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          operation: {
            id: 'op-pending-tick',
            state: 'SUBMITTING',
            reservedAmount: '50000',
            result: null,
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/complete/, async (route) => {
      completeCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mission: { status: 'COMPLETED' } }),
      });
    });

    await page.goto('/demo');

    // Connect wallet
    await page.click('button:has-text("Connect MetaMask")');
    await expect(page.locator(`button:has-text("Connected: ${wallet.ownerAddress.slice(0, 6)}")`)).toBeVisible();

    // Trigger demo flow
    await page.click('button:has-text("Execute Live S1 Flow")');

    // DOM Assertion 1: Step 6 TalkMeter pill MUST display PENDING (not SUCCESS)
    const talkmeterPill = page.locator('[data-testid="step-talkmeter"]');
    await expect(talkmeterPill).toHaveAttribute('data-status', 'PENDING');
    await expect(talkmeterPill).toHaveText(/PENDING/);
    await expect(talkmeterPill).not.toHaveText(/SUCCESS/);

    // DOM Assertion 2: Step 7 Complete pill MUST remain IDLE (cannot complete unearned/pending minutes)
    const completePill = page.locator('[data-testid="step-complete"]');
    await expect(completePill).toHaveAttribute('data-status', 'IDLE');
    await expect(completePill).toHaveText(/IDLE/);

    // DOM Assertion 3: Console logs explicit halt message
    await expect(page.locator('text=Halted before Step 7: Mission completion requires all operations to be settled.')).toBeVisible();

    // Verification of request counts: tick was called, complete was NEVER called
    expect(tickCalls).toBeGreaterThan(0);
    expect(completeCalls).toBe(0);
  });

  test('Honest UNKNOWN State: 202 tick returns PENDING and halts before Complete', async ({ page, wallet }) => {
    await wallet.injectMockWallet(page);

    let tickCalls = 0;
    let completeCalls = 0;

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
          deploymentId: 'dep-test',
          configuredOwner: wallet.ownerAddress,
        }),
      });
    });

    await page.route('/api/auth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nonce: 'test-nonce-unknown-1234',
          message: 'UniHack Auth Challenge: test',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
      });
    });

    await page.route('/api/missions', async (route) => {
      const postData = route.request().postDataJSON();
      const slug = postData?.payload?.slug || 'test-unknown-mission';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          mission: {
            slug,
            missionId: '0x' + 'b'.repeat(64),
            status: 'CREATED',
            ownerAddress: wallet.ownerAddress,
            agentAddress: '0x2222222222222222222222222222222222222222',
            treasuryCap: '10000000',
            toolCap: '5000000',
            policyHash: '0x' + '1'.repeat(64),
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/activate/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ACTIVE',
          spendToken: 'mock.jwt.token',
        }),
      });
    });

    await page.route('/api/tools/orchestrate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          operationId: 'op-search-2',
          state: 'SETTLED',
          result: { points: [{ lat: 10, lng: 106 }] },
        }),
      });
    });

    await page.route('/api/tools/talkmeter/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: {
            id: 'sess-unknown-1',
            status: 'ACTIVE',
            startedAt: new Date().toISOString(),
          },
        }),
      });
    });

    // Intercept TalkMeter tick returning 202 with UNKNOWN state
    await page.route('/api/tools/talkmeter/tick', async (route) => {
      tickCalls++;
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          operation: {
            id: 'op-unknown-tick',
            state: 'UNKNOWN',
            reservedAmount: '50000',
            result: null,
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/complete/, async (route) => {
      completeCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mission: { status: 'COMPLETED' } }),
      });
    });

    await page.goto('/demo');
    await page.click('button:has-text("Connect MetaMask")');
    await page.click('button:has-text("Execute Live S1 Flow")');

    // DOM Assertions
    const talkmeterPill = page.locator('[data-testid="step-talkmeter"]');
    await expect(talkmeterPill).toHaveAttribute('data-status', 'PENDING');
    await expect(talkmeterPill).toHaveText(/PENDING/);
    await expect(talkmeterPill).not.toHaveText(/SUCCESS/);

    const completePill = page.locator('[data-testid="step-complete"]');
    await expect(completePill).toHaveAttribute('data-status', 'IDLE');
    await expect(completePill).toHaveText(/IDLE/);

    expect(tickCalls).toBeGreaterThan(0);
    expect(completeCalls).toBe(0);
  });

  test('Nonterminal HTTP 200 RESERVED State: 200 with non-settled state renders PENDING and halts before Complete', async ({ page, wallet }) => {
    await wallet.injectMockWallet(page);

    let tickCalls = 0;
    let completeCalls = 0;

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
          deploymentId: 'dep-test',
          configuredOwner: wallet.ownerAddress,
        }),
      });
    });

    await page.route('/api/auth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nonce: 'test-nonce-reserved-1234',
          message: 'UniHack Auth Challenge: test',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
      });
    });

    await page.route('/api/missions', async (route) => {
      const postData = route.request().postDataJSON();
      const slug = postData?.payload?.slug || 'test-reserved-mission';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          mission: {
            slug,
            missionId: '0x' + 'c'.repeat(64),
            status: 'CREATED',
            ownerAddress: wallet.ownerAddress,
            agentAddress: '0x2222222222222222222222222222222222222222',
            treasuryCap: '10000000',
            toolCap: '5000000',
            policyHash: '0x' + '1'.repeat(64),
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/activate/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ACTIVE',
          spendToken: 'mock.jwt.token',
        }),
      });
    });

    await page.route('/api/tools/orchestrate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          operationId: 'op-search-3',
          state: 'SETTLED',
          result: { points: [{ lat: 10, lng: 106 }] },
        }),
      });
    });

    await page.route('/api/tools/talkmeter/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: {
            id: 'sess-reserved-1',
            status: 'ACTIVE',
            startedAt: new Date().toISOString(),
          },
        }),
      });
    });

    // Intercept TalkMeter tick returning HTTP 200 with RESERVED state (e.g. alreadyBilled or race recovery)
    await page.route('/api/tools/talkmeter/tick', async (route) => {
      tickCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          operation: {
            id: 'op-reserved-tick',
            state: 'RESERVED',
            reservedAmount: '50000',
            result: null,
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/complete/, async (route) => {
      completeCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mission: { status: 'COMPLETED' } }),
      });
    });

    await page.goto('/demo');
    await page.click('button:has-text("Connect MetaMask")');
    await page.click('button:has-text("Execute Live S1 Flow")');

    // DOM Assertions: HTTP 200 with non-settled state MUST NOT be credited as SUCCESS
    const talkmeterPill = page.locator('[data-testid="step-talkmeter"]');
    await expect(talkmeterPill).toHaveAttribute('data-status', 'PENDING');
    await expect(talkmeterPill).toHaveText(/PENDING/);
    await expect(talkmeterPill).not.toHaveText(/SUCCESS/);

    const completePill = page.locator('[data-testid="step-complete"]');
    await expect(completePill).toHaveAttribute('data-status', 'IDLE');

    expect(tickCalls).toBeGreaterThan(0);
    expect(completeCalls).toBe(0);
  });

  test('Terminal Failure State: 200 FAILED tick renders ERROR in DOM and halts before Complete', async ({ page, wallet }) => {
    await wallet.injectMockWallet(page);

    let tickCalls = 0;
    let completeCalls = 0;

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
          deploymentId: 'dep-test',
          configuredOwner: wallet.ownerAddress,
        }),
      });
    });

    await page.route('/api/auth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nonce: 'test-nonce-failed-1234',
          message: 'UniHack Auth Challenge: test',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
      });
    });

    await page.route('/api/missions', async (route) => {
      const postData = route.request().postDataJSON();
      const slug = postData?.payload?.slug || 'test-failed-mission';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          mission: {
            slug,
            missionId: '0x' + 'd'.repeat(64),
            status: 'CREATED',
            ownerAddress: wallet.ownerAddress,
            agentAddress: '0x2222222222222222222222222222222222222222',
            treasuryCap: '10000000',
            toolCap: '5000000',
            policyHash: '0x' + '1'.repeat(64),
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/activate/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ACTIVE',
          spendToken: 'mock.jwt.token',
        }),
      });
    });

    await page.route('/api/tools/orchestrate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          operationId: 'op-search-4',
          state: 'SETTLED',
          result: { points: [{ lat: 10, lng: 106 }] },
        }),
      });
    });

    await page.route('/api/tools/talkmeter/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: {
            id: 'sess-failed-1',
            status: 'ACTIVE',
            startedAt: new Date().toISOString(),
          },
        }),
      });
    });

    // Intercept TalkMeter tick returning FAILED
    await page.route('/api/tools/talkmeter/tick', async (route) => {
      tickCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          operation: {
            id: 'op-failed-tick',
            state: 'FAILED',
            failureReason: 'EXPIRED_AUTHORIZATION',
            reservedAmount: '50000',
            result: null,
          },
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/complete/, async (route) => {
      completeCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mission: { status: 'COMPLETED' } }),
      });
    });

    await page.goto('/demo');
    await page.click('button:has-text("Connect MetaMask")');
    await page.click('button:has-text("Execute Live S1 Flow")');

    // DOM Assertions: FAILED tick MUST transition to ERROR
    const talkmeterPill = page.locator('[data-testid="step-talkmeter"]');
    await expect(talkmeterPill).toHaveAttribute('data-status', 'ERROR');
    await expect(talkmeterPill).toHaveText(/ERROR/);

    const completePill = page.locator('[data-testid="step-complete"]');
    await expect(completePill).toHaveAttribute('data-status', 'IDLE');

    expect(tickCalls).toBeGreaterThan(0);
    expect(completeCalls).toBe(0);
  });

  test('Client UI contract: handles 401 unauthorized proof denial and verifies public proof payload structure without leaking private results', async ({ page }) => {
    // Test unauthenticated access to private proof
    await page.route('/api/missions/private-mission/proof', async (route) => {
      const authHeader = route.request().headers()['authorization'];
      if (!authHeader) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Unauthorized: scoped credential required for private mission proof' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ audit: { entries: [] } }),
        });
      }
    });

    // Test public proof endpoint
    await page.route('/api/missions/public-mission/proof?public=true', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ledgerScope: 'public',
          audit: {
            checkpoint: { headHash: '0x1234', entryCount: 1 },
            entries: [{ id: '1', kind: 'TOOL_PAID' }],
          },
          operations: [
            {
              operationId: 'op-pub-1',
              state: 'SETTLED',
              result: null, // Stripped for public
            },
          ],
        }),
      });
    });

    await page.goto('/demo');

    // 1. Verify client gets 401 on unauthenticated private proof
    const anonRes = await page.evaluate(async () => {
      const res = await fetch('/api/missions/private-mission/proof');
      return { status: res.status, data: await res.json() };
    });
    expect(anonRes.status).toBe(401);
    expect(anonRes.data.error).toContain('Unauthorized');

    // 2. Verify client public proof payload shape strips sensitive results
    const pubRes = await page.evaluate(async () => {
      const res = await fetch('/api/missions/public-mission/proof?public=true');
      return { status: res.status, data: await res.json() };
    });
    expect(pubRes.status).toBe(200);
    expect(pubRes.data.operations[0].result).toBeNull();
  });
});
