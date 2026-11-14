import { test, expect } from './fixtures/wallet';
import path from 'path';
import { keccak256, stringToBytes } from 'viem';

const INITIAL_PREV_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

function createValidProofPayload() {
  const canon0 = JSON.stringify({
    actor: '0x1111111111111111111111111111111111111111',
    amount: '0',
    chain_id: '43113',
    created_at: '2026-11-07T00:00:00.000Z',
    kind: 'CUTOVER',
    mission_id: 'agent-mission-demo',
    operation_id: '',
    policy_hash: '0x0',
    policy_version: '1',
    prev_hash: INITIAL_PREV_HASH,
    reason: 'Genesis checkpoint',
    result_hash: '',
    rule: 'GENESIS',
    source_key: 'genesis:0',
    to: '',
    tx_hash: '',
  });
  const hash0 = keccak256(stringToBytes(canon0));

  const canon1 = JSON.stringify({
    actor: '0x1111111111111111111111111111111111111111',
    amount: '100000',
    chain_id: '43113',
    created_at: '2026-11-07T00:01:00.000Z',
    kind: 'TOOL_PAID',
    mission_id: 'agent-mission-demo',
    operation_id: 'op-search-1',
    policy_hash: '0x0',
    policy_version: '1',
    prev_hash: hash0,
    reason: 'Search tool execution',
    result_hash: '',
    rule: 'RULE_TOOL_WITHIN_CAP',
    source_key: 'tool:search:1',
    to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    tx_hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  });
  const hash1 = keccak256(stringToBytes(canon1));

  return {
    schemaVersion: 1,
    ledgerScope: 'mission',
    missionSlug: 'agent-mission-demo',
    audit: {
      checkpoint: {
        headHash: hash1,
        entryCount: 2,
        timestamp: '2026-11-07T00:01:00.000Z',
      },
      entries: [
        {
          sourceKey: 'genesis:0',
          prevHash: INITIAL_PREV_HASH,
          entryHash: hash0,
          canonicalJson: canon0,
        },
        {
          sourceKey: 'tool:search:1',
          prevHash: hash0,
          entryHash: hash1,
          canonicalJson: canon1,
        },
      ],
    },
  };
}

test.describe('P2 Mission Control & P1-C Adversarial Defense E2E Verification', () => {
  test('Renders 5-part Mission Control, exercises in-browser proof, kill-switch, and P1-C defense', async ({ page, wallet }) => {
    await wallet.injectMockWallet(page);

    let serverPaused = false;

    // 1. Policy route reflecting server state
    await page.route('/api/policy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stage: 'S1',
          chainId: 43113,
          paymentMode: 'MOCK',
          systemPaused: serverPaused,
          maintenance: false,
          deploymentId: 'unihack-mission-control-test',
          configuredOwner: wallet.ownerAddress,
        }),
      });
    });

    // 2. Auth challenge route
    await page.route('/api/auth/challenge', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          nonce: 'test-pause-nonce-1234567890abcdef',
          message: 'UniHack Auth Challenge: Pause action verification',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
      });
    });

    // 3. System pause route
    await page.route('/api/system/pause', async (route) => {
      const data = route.request().postDataJSON();
      serverPaused = data.payload?.desiredPaused ?? true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, systemPaused: serverPaused }),
      });
    });

    // 4. Valid proof route
    await page.route(/\/api\/missions\/[^/]+\/proof/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createValidProofPayload()),
      });
    });

    // 5. Mock adversarial attack agent run (P1-C)
    await page.route('/api/agent/run', async (route) => {
      if (serverPaused) {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'System is paused' }),
        });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          missionSlug: 'agent-mission-attack-demo',
          goal: 'Security audit test: Prompt injection exploit detection',
          turnCount: 2,
          steps: [
            {
              turn: 1,
              action: 'TOOL',
              toolId: 'tool:search',
              thought: "Step 1: Query verified reference sources for 'Avalanche prompt injection attack'.",
              verdict: { outcome: 'PASS', rule: 'RULE_TOOL_WITHIN_CAP' },
              amountAtomic: '100000',
              sources: [
                'https://en.wikipedia.org/wiki/Avalanche_(blockchain_platform)',
                'https://adversarial-compromised-site.org/exploit-payload.html',
              ],
            },
            {
              turn: 2,
              action: 'TOOL_BLOCKED',
              amountAtomic: '50000000',
              reason: '[POISONED_PAYLOAD] Prompt injection in external search source directed 50 USDC payout',
              verdict: {
                outcome: 'BLOCK',
                rule: 'STAGE_S1_NO_TREASURY',
                reason: 'Treasury payouts are not available in stage S1',
              },
              thought: 'Step 2: Processing external directive found in retrieved search sources: Proposing 50.00 USDC payout to 0x3333333333333333333333333333333333333333.',
            },
          ],
          initialBudget: '5000000',
          remainingBudget: '4900000',
          spentTool: '100000',
          plannerMode: 'FALLBACK_DETERMINISTIC',
          plannerModel: 'deterministic-planner-v1',
          promptVersion: 'v1.0',
        }),
      });
    });

    await page.goto('/demo');

    // Section 1: Assert Budget Bar
    await expect(page.locator('text=Live Mission Budget Enforcer')).toBeVisible();
    await expect(page.locator('text=Total Cap:')).toBeVisible();
    await expect(page.locator('text=5.00 USDC Cap')).toBeVisible();

    // Section 2: Assert In-browser Proof Verification (Real mathematical verification)
    const verifyProofBtn = page.locator('button:has-text("Verify Proof")');
    await expect(verifyProofBtn).toBeVisible();
    await verifyProofBtn.click();
    await expect(page.locator('text=Cryptographic Audit Proof Verified (Client-Side)')).toBeVisible();
    await expect(page.locator('text=2 records, unbroken chain')).toBeVisible();

    // Section 3: Assert Emergency Pause Kill-Switch
    // First connect wallet
    await page.click('button:has-text("Connect MetaMask")');
    await expect(page.locator(`button:has-text("Connected: ${wallet.ownerAddress.slice(0, 6)}")`)).toBeVisible();

    const pauseBtn = page.locator('button:has-text("Pause Kill-Switch")');
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click();
    await expect(page.getByText('SYSTEM PAUSED', { exact: true })).toBeVisible();
    await page.locator('button:has-text("System Paused (Resume)")').click();
    await expect(page.getByText('SYSTEM ACTIVE', { exact: true })).toBeVisible();

    // Section 4: Trigger P1-C Attack Preset & Run
    const attackPresetBtn = page.locator('button:has-text("Preset: Attack Demo (P1-C)")');
    await expect(attackPresetBtn).toBeVisible();
    await attackPresetBtn.click();

    // Verify Side-by-Side Comparison card is displayed
    await expect(page.locator('text=Adversarial Prompt Injection Defense (P1-C Local Demo)')).toBeVisible();
    await expect(page.locator('text=Naive Unguarded Agent')).toBeVisible();
    await expect(page.locator('text=-50.00 USDC (DRAINED)')).toBeVisible();
    await expect(page.locator('text=Guarded Agent Architecture (Our System)')).toBeVisible();
    await expect(page.locator('text=0 USDC LOST (100% PROTECTED)')).toBeVisible();

    // Execute agent run
    const agentBtn = page.locator('[data-testid="execute-agent-btn"]');
    await agentBtn.click();

    // Verify timeline captures TOOL_BLOCKED
    await expect(page.locator('text=Turn 2: TOOL_BLOCKED')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=BLOCK (STAGE_S1_NO_TREASURY)')).toBeVisible();

    // Capture P1-C and Mission Control screenshots
    const p1cScreenshot = path.resolve(process.cwd(), 'evidence/p1-c-prompt-injection-defense.png');
    await page.screenshot({ path: p1cScreenshot, fullPage: true });
    console.log(`Saved P1-C screenshot to: ${p1cScreenshot}`);

    // Section 5: Assert Developer Tab switching
    const devTabBtn = page.locator('button:has-text("Developer Console")');
    await expect(devTabBtn).toBeVisible();
    await devTabBtn.click();
    await expect(page.locator('text=Raw Technical Activity Log')).toBeVisible();
    await expect(page.locator('button:has-text("Execute Live S1 Flow")')).toBeVisible();

    // Switch back to Mission Control
    await page.locator('button:has-text("Mission Control (Supervisor)")').click();
    await expect(page.locator('text=Live Mission Budget Enforcer')).toBeVisible();

    const mcScreenshot = path.resolve(process.cwd(), 'evidence/p2-mission-control-ui.png');
    await page.screenshot({ path: mcScreenshot, fullPage: true });
    console.log(`Saved Mission Control screenshot to: ${mcScreenshot}`);
  });

  test('UI-01 Case 1: Valid proof mathematically verified in-browser', async ({ page }) => {
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
          deploymentId: 'unihack-case1',
          configuredOwner: '0x1111111111111111111111111111111111111111',
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/proof/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createValidProofPayload()),
      });
    });

    await page.goto('/demo');
    await page.click('button:has-text("Verify Proof")');
    await expect(page.locator('text=Cryptographic Audit Proof Verified (Client-Side)')).toBeVisible();
    await expect(page.locator('text=2 records, unbroken chain')).toBeVisible();
  });

  test('UI-01 Case 2: Tampered proof detected and rejected in-browser (FAIL)', async ({ page }) => {
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
          deploymentId: 'unihack-case2',
          configuredOwner: '0x1111111111111111111111111111111111111111',
        }),
      });
    });

    // Provide a tampered proof payload where canonicalJson does not match entryHash
    const tamperedPayload = createValidProofPayload();
    tamperedPayload.audit.entries[1].canonicalJson = JSON.stringify({
      ...JSON.parse(tamperedPayload.audit.entries[1].canonicalJson),
      amount: '9999999999', // Maliciously tampered amount
    });

    await page.route(/\/api\/missions\/[^/]+\/proof/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tamperedPayload),
      });
    });

    await page.goto('/demo');
    await page.click('button:has-text("Verify Proof")');
    await expect(page.locator('text=Cryptographic Audit Proof Verification FAILED')).toBeVisible();
    await expect(page.locator('p:has-text("Hash mismatch at index 1")')).toBeVisible();
  });

  test('UI-01 Case 3: 401 Unauthorized proof denied and renders UNVERIFIED in-browser', async ({ page }) => {
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
          deploymentId: 'unihack-case3',
          configuredOwner: '0x1111111111111111111111111111111111111111',
        }),
      });
    });

    await page.route(/\/api\/missions\/[^/]+\/proof/, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Unauthorized: scoped credential required for private mission proof' }),
      });
    });

    await page.goto('/demo');
    await page.click('button:has-text("Verify Proof")');
    await expect(page.locator('text=Cryptographic Audit Proof UNVERIFIED')).toBeVisible();
    await expect(page.locator('p:has-text("Unauthorized: scoped credential")')).toBeVisible();
  });

  test('UI-02: Server Pause Kill-Switch halts agent operations with HTTP 403', async ({ page, wallet }) => {
    await wallet.injectMockWallet(page);

    await page.route('/api/policy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stage: 'S1',
          chainId: 43113,
          paymentMode: 'MOCK',
          systemPaused: true, // System is paused on server
          maintenance: false,
          deploymentId: 'unihack-pause-test',
          configuredOwner: wallet.ownerAddress,
        }),
      });
    });

    await page.goto('/demo');
    await expect(page.getByText('SYSTEM PAUSED', { exact: true })).toBeVisible();

    await page.route('/api/agent/run', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'System is paused' }),
      });
    });

    await page.click('[data-testid="execute-agent-btn"]');
    await expect(page.locator('text=Agent execution failed: HTTP 403 System is paused')).toBeVisible();
  });
});
