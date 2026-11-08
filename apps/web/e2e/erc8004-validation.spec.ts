import { test, expect } from './fixtures/wallet';
import path from 'path';
import fs from 'fs';

test.describe('WOW-W2: ERC-8004 Validation Registry on Avalanche Fuji', () => {
  test.use({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  const deckShotsDir = path.resolve(process.cwd(), '../../artifacts/submission-s1/deck-shots');

  test.beforeAll(async () => {
    const { prisma } = await import('../lib/db');
    await prisma.mission.upsert({
      where: { slug: 'fuji-live-mission-s1b' },
      update: {
        publicPublished: true,
      },
      create: {
        slug: 'fuji-live-mission-s1b',
        missionId: '0xeb8f4a47323136c557439a5f0f90b73222f28b8725c0e4e480256621c10682f4',
        ownerAddress: '0x4bc93356c180ba2dd13a4a1cf43405bd0eb58f7c',
        agentAddress: '0x374b8a126fdb9e5deec8307da385076155af3d72',
        treasuryCap: '2000000',
        toolCap: '500000',
        spentTool: '100000',
        reservedTool: '0',
        status: 'ACTIVE',
        publicPublished: true,
        expiresAt: new Date(Date.now() + 86400000),
        payeesJson: '["0x1111111111111111111111111111111111111111"]',
        payeeRoot: '0xa7409058568815d08a7ad3c7d4fd44cf1dec90c620cb31e55ad24c654f7ba34f',
        configVersion: 1,
        policyHash: '0x35bad8ba756db51dc6337f5e293210fa3a4e511636987a56e26f256b5032c3da',
        auditHeadHash: '0x7d46d87541ed812ada52afe7f1d3144d6a2b90b359a66162e54c8e41d675be2f',
        auditEntryCount: 1,
      },
    });
  });

  test.beforeEach(async ({ page }) => {
    // Hide dev overlay indicators
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = `
        nextjs-portal,
        #nextjs-dev-indicator,
        [data-nextjs-dev-indicator],
        [data-nextjs-toast-wrapper],
        #__next-build-watcher {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `;
      document.head.appendChild(style);
    });
  });

  test('Validates live ERC-8004 score 100 and validator address from Fuji registry', async ({ page }) => {
    await page.goto('/verify/fuji-live-mission-s1b');

    // Wait for main content to load
    await expect(page.locator('h1')).toContainText('ĐỪNG TIN CHÚNG TÔI — TỰ KIỂM CHỨNG');

    // Assert ERC-8004 Validation card
    const statusBadge = page.locator('[data-testid="erc8004-status-badge"]');
    await expect(statusBadge).toBeVisible({ timeout: 15000 });
    await expect(statusBadge).toContainText('Điểm xác thực: 100/100');

    const tagBadge = page.locator('[data-testid="erc8004-tag-badge"]');
    await expect(tagBadge).toBeVisible();
    await expect(tagBadge).toHaveText('verified-full');

    const validatorEl = page.locator('[data-testid="erc8004-validator-address"]');
    await expect(validatorEl).toBeVisible();
    await expect(validatorEl).toContainText('0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5');

    const agentIdEl = page.locator('[data-testid="erc8004-agent-id"]');
    await expect(agentIdEl).toBeVisible();
    await expect(agentIdEl).toContainText('#294');

    const txLink = page.locator('[data-testid="erc8004-tx-link"]');
    await expect(txLink).toBeVisible();
    const href = await txLink.getAttribute('href');
    expect(href).toContain('testnet.snowtrace.io/tx/0x62451c36b6488cf4423bd7427e560ac2e3de46144d7ba5c30d81c55df7fe1564');

    // Capture screenshot
    if (!fs.existsSync(deckShotsDir)) {
      fs.mkdirSync(deckShotsDir, { recursive: true });
    }
    await page.screenshot({
      path: path.join(deckShotsDir, 'wow-w2-erc8004.png'),
      fullPage: true,
    });
  });
});
