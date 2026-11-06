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
