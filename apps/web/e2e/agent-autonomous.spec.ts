import { test, expect } from './fixtures/wallet';
import path from 'path';

test.describe('AGENT-01: Autonomous AI Agent Live Mission & Reasoning', () => {
  test('Executes autonomous agent planning loop, renders reasoning timeline, and captures deliverable', async ({ page }) => {
    // Intercept initial policy fetch
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
          deploymentId: 'unihack-agent-test',
          configuredOwner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        }),
      });
    });

    // Mock agent run for UI browser test
    await page.route('/api/agent/run', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          missionSlug: 'agent-mission-646416',
          goal: 'Tóm tắt 3 nguồn về Avalanche blockchain architecture và transaction fees',
          turnCount: 3,
          steps: [
            {
              turn: 1,
              action: 'TOOL',
              toolId: 'tool:search',
              thought: "Step 1: Query verified reference sources for 'Avalanche blockchain transaction fees' to gather facts.",
              verdict: { outcome: 'PASS', rule: 'RULE_TOOL_WITHIN_CAP' },
              amountAtomic: '100000',
              sources: [
                'https://en.wikipedia.org/wiki/Avalanche_(blockchain_platform)',
                'https://en.wikipedia.org/wiki/Ethereum',
                'https://en.wikipedia.org/wiki/Proof_of_work',
              ],
            },
            {
              turn: 2,
              action: 'TOOL',
              toolId: 'tool:summary',
              thought: 'Step 2: Synthesize 3 search findings into an authoritative deliverable.',
              verdict: { outcome: 'PASS', rule: 'RULE_TOOL_WITHIN_CAP' },
              amountAtomic: '500000',
            },
            {
              turn: 3,
              action: 'DONE',
              thought: 'Step 3: All prerequisite tool analyses settled and verified. Generating signed deliverable.',
            },
          ],
          deliverable: {
            goal: 'Tóm tắt 3 nguồn về Avalanche blockchain architecture và transaction fees',
            missionSlug: 'agent-mission-646416',
            summary: '[FIXTURE] Summary of sources: Avalanche (blockchain platform) is a public blockchain and smart-contract platform launched in September 2020 by Ava Labs.',
            sources: [
              'https://en.wikipedia.org/wiki/Avalanche_(blockchain_platform)',
              'https://en.wikipedia.org/wiki/Ethereum',
              'https://en.wikipedia.org/wiki/Proof_of_work',
            ],
            points: ['Avalanche consensus platform', 'Sub-second finality'],
            plannerMode: 'FALLBACK_DETERMINISTIC',
            plannerModel: 'deterministic-planner-v1',
            promptVersion: 'v1.0',
            completedAt: new Date().toISOString(),
          },
          deliverableHash: '0xe708441f3a2ccdefaa5f2d5e71eb0e9a929bfdea86d2bdcffb46c70c79e80f63',
          initialBudget: '5000000',
          remainingBudget: '4400000',
          spentTool: '600000',
          plannerMode: 'FALLBACK_DETERMINISTIC',
          plannerModel: 'deterministic-planner-v1',
          promptVersion: 'v1.0',
        }),
      });
    });

    await page.goto('/demo');
    await expect(page.locator('h1')).toContainText('Interactive S1 Production Demo');

    // Click "Execute Autonomous Agent Mission"
    const agentBtn = page.locator('[data-testid="execute-agent-btn"]');
    await expect(agentBtn).toBeVisible();
    await agentBtn.click();

    // Verify Agent completes turns and renders deliverable
    await expect(page.locator('text=Verified Deliverable Output')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Cited Real Reference Sources:')).toBeVisible();
    await expect(page.locator('text=Turn 1: TOOL')).toBeVisible();
    await expect(page.locator('text=Turn 2: TOOL')).toBeVisible();
    await expect(page.locator('text=Verdict:').first()).toBeVisible();

    // Capture screenshot as required by AGENT-01 acceptance criteria
    const screenshotPath = path.resolve(process.cwd(), 'evidence/agent-01-autonomous-mission.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved screenshot to: ${screenshotPath}`);
  });
});
