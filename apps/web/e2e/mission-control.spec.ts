import { test, expect } from './fixtures/wallet';
import path from 'path';

test.describe('P2 Mission Control & P1-C Adversarial Defense E2E Verification', () => {
  test('Renders 5-part Mission Control, exercises in-browser proof, kill-switch, and P1-C defense', async ({ page }) => {
    // 1. Mock policy route
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
          deploymentId: 'unihack-mission-control-test',
          configuredOwner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        }),
      });
    });

    // 2. Mock adversarial attack agent run (P1-C)
    await page.route('/api/agent/run', async (route) => {
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

    // Section 2: Assert In-browser Proof Verification
    const verifyProofBtn = page.locator('button:has-text("Verify Proof")');
    await expect(verifyProofBtn).toBeVisible();
    await verifyProofBtn.click();
    await expect(page.locator('text=Cryptographic Audit Proof Verified (Client-Side)')).toBeVisible();

    // Section 3: Assert Emergency Pause Kill-Switch
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
});
