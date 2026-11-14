import { test, expect } from './fixtures/wallet';

/**
 * Real Integration Browser E2E Spec (Unmocked End-to-End Flow).
 *
 * Requirements:
 * 1. Playwright Chromium browser binary installed (`npx playwright install chromium`).
 * 2. Dedicated disposable PostgreSQL test database running on port 55432 with migrations deployed.
 * 3. Next.js server running on test port (default 3100).
 *
 * Validation Gate: REAL_INTEGRATION_BROWSER_SPEC.
 * Unlike ui-mocked specs, this spec does NOT call page.route() to mock API responses.
 * It drives the real wallet -> HTTP route handlers -> Prisma -> PostgreSQL -> UI cycle.
 */
test.describe('Real Integration Browser Flow: Unmocked S1 Vertical Lifecycle', () => {
  test('Executes live vertical flow against real database without API route interception', async ({ page, wallet }) => {
    // 1. Inject isolated EIP-1193 Web3 provider into browser context
    await wallet.injectMockWallet(page);

    // 2. Navigate to live interactive demo
    await page.goto('/demo');

    // Verify initial idle state
    await expect(page.locator('h1')).toHaveText('Interactive S1 Production Demo');

    // 3. Connect Owner Wallet
    const connectBtn = page.locator('button:has-text("Connect MetaMask")');
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    await expect(page.locator(`button:has-text("Connected: ${wallet.ownerAddress.slice(0, 6)}")`)).toBeVisible();

    // 4. Trigger Live S1 Flow (Executes real HTTP requests against live Next.js backend and real database)
    const executeBtn = page.locator('button:has-text("Execute Live S1 Flow")');
    await expect(executeBtn).toBeVisible();
    await expect(executeBtn).toBeEnabled();
    await executeBtn.click();

    // 5. Assert Step 1 (Policy) transitions to SUCCESS
    const policyPill = page.locator('[data-testid="step-policy"]');
    await expect(policyPill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 6. Assert Step 2 (Challenge & Authentication) transitions to SUCCESS
    const challengePill = page.locator('[data-testid="step-challenge"]');
    await expect(challengePill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 7. Assert Step 3 (Mission Creation) transitions to SUCCESS
    const createPill = page.locator('[data-testid="step-create"]');
    await expect(createPill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 8. Assert Step 4 (Mission Activation) transitions to SUCCESS
    const activatePill = page.locator('[data-testid="step-activate"]');
    await expect(activatePill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 9. Assert Step 5 (Tool Orchestration) transitions to SUCCESS
    const searchPill = page.locator('[data-testid="step-search"]');
    await expect(searchPill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 10. Assert Step 6 (TalkMeter Session Guard & Stop) transitions to SUCCESS
    const talkmeterPill = page.locator('[data-testid="step-talkmeter"]');
    await expect(talkmeterPill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 11. Assert Step 7 (Mission Completion with Artifact Hash) transitions to SUCCESS
    const completePill = page.locator('[data-testid="step-complete"]');
    await expect(completePill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 12. Assert Step 8 (Scoped Audit Proof) transitions to SUCCESS
    const proofPill = page.locator('[data-testid="step-proof"]');
    await expect(proofPill).toHaveAttribute('data-status', 'SUCCESS', { timeout: 15000 });

    // 13. Verify final success log banner
    await expect(page.locator('text=SUCCESS: Complete vertical S1 mission lifecycle executed and verified against live API routes.')).toBeVisible();
  });
});
