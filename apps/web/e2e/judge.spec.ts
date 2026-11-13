import { test, expect } from '@playwright/test';

test.describe('Judge Mode E2E Spec (Round 13)', () => {
  test('HomePage has large Judge Mode CTA button that navigates to /judge', async ({ page }) => {
    await page.goto('/');

    const judgeBtn = page.locator('a[href="/judge"]').first();
    await expect(judgeBtn).toBeVisible();
    await expect(judgeBtn).toContainText(/Judge mode/i);

    await judgeBtn.click();
    await expect(page).toHaveURL(/\/judge/);
    await expect(page.locator('h1')).toContainText(/Judge Mode|Chế độ Giám khảo/i);
  });

  test('Judge page renders Block 1 receipts, interactive simulation in Block 2, and terminal commands in Block 3', async ({
    page,
  }) => {
    // Intercept /api/judge/receipts with mock data for deterministic ui-mocked execution
    await page.route('**/api/judge/receipts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          contractAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
          chainId: 43113,
          receipts: [
            {
              id: 'missionA',
              step: 6,
              label: 'Mission A: Global Allowlist Mode',
              labelVi: 'Nhiệm vụ A: Chế độ Allowlist Toàn Cục',
              description: 'Poisoned invoice to off-mission vendor.',
              descriptionVi: 'Hóa đơn nhiễm độc gửi vendor ngoài nhiệm vụ.',
              txHash: '0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6',
              status: 'success',
              blockNumber: 61001944,
              gasUsed: '461740',
              outflow: '+0.01 USDC (Drained to controlled vendor)',
              outflowVi: '+0.01 USDC (Thoát vốn về vendor kiểm soát)',
              snowtraceUrl: 'https://testnet.snowtrace.io/tx/0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6',
            },
            {
              id: 'missionB_negative',
              step: 7,
              label: 'Mission B: Negative Control (Off-mission vendor)',
              labelVi: 'Nhiệm vụ B: Đối chứng Âm (Vendor ngoài nhiệm vụ)',
              description: 'Blocked on-chain.',
              descriptionVi: 'Bị chặn on-chain.',
              txHash: '0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38',
              status: 'reverted',
              revertReason: 'PayeeNotInMissionSet',
              blockNumber: 61001947,
              gasUsed: '60000',
              outflow: '0.00 USDC (Reverted on-chain, 0 USDC leaked)',
              outflowVi: '0.00 USDC (Revert trên hợp đồng, 0 USDC thất thoát)',
              snowtraceUrl: 'https://testnet.snowtrace.io/tx/0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38',
            },
            {
              id: 'missionB_positive',
              step: 8,
              label: 'Mission B: Positive Control (Legitimate Owner payee)',
              labelVi: 'Nhiệm vụ B: Đối chứng Dương (Chủ sở hữu hợp lệ)',
              description: 'Auto-payout executes.',
              descriptionVi: 'Tự động giải ngân.',
              txHash: '0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315',
              status: 'success',
              blockNumber: 61001949,
              gasUsed: '406027',
              outflow: '+0.01 USDC (Paid safely to Owner)',
              outflowVi: '+0.01 USDC (Thanh toán an toàn về Owner)',
              snowtraceUrl: 'https://testnet.snowtrace.io/tx/0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315',
            },
          ],
        }),
      });
    });

    // Intercept /api/judge/simulate
    await page.route('**/api/judge/simulate', async (route) => {
      const body = route.request().postDataJSON();
      if (body.recipient?.toLowerCase() === '0x4bc93356c180ba2dd13a4a1cf43405bd0eb58f7c') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            outcome: 'SUCCESS',
            recipient: body.recipient,
            amountAtomic: 10000,
            amountUsdc: '0.010000 USDC',
            missionBExpiry: '2026-12-13T11:44:08.000Z',
            message: 'Simulation succeeded! The Fuji contract accepts this recipient.',
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            outcome: 'REVERT',
            revertReason: 'PayeeNotInMissionSet',
            recipient: body.recipient,
            amountAtomic: 10000,
            amountUsdc: '0.010000 USDC',
            missionBExpiry: '2026-12-13T11:44:08.000Z',
            message: 'Contract strictly rejected this payout proposal: PayeeNotInMissionSet',
          }),
        });
      }
    });

    await page.goto('/judge');

    // 1. Check Block 1 Receipts
    await expect(page.locator('#block1-heading')).toBeVisible();
    await expect(page.getByText('STEP 6')).toBeVisible();
    await expect(page.getByText('STEP 7')).toBeVisible();
    await expect(page.getByText('STEP 8')).toBeVisible();
    await expect(page.getByText(/PayeeNotInMissionSet/).first()).toBeVisible();

    // 2. Check Block 2 Interactive Simulation - Negative Case (Random Attacker)
    await expect(page.locator('#block2-heading')).toBeVisible();
    const askContractBtn = page.getByRole('button', { name: /Ask the Fuji Contract|Hỏi Hợp Đồng Fuji/i });
    await expect(askContractBtn).toBeVisible();
    await askContractBtn.click();

    // Verify Revert display
    await expect(page.getByText(/CONTRACT REVERTED|HỢP ĐỒNG FUJI TỪ CHỐI/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/PayeeNotInMissionSet/).first()).toBeVisible();

    // Check Block 2 Interactive Simulation - Positive Control Case (Owner)
    const testOwnerBtn = page.getByRole('button', { name: /Test Owner|Thử Ví Owner/i });
    await expect(testOwnerBtn).toBeVisible();
    await testOwnerBtn.click();

    // Verify Success display
    await expect(page.getByText(/CONTRACT ACCEPTED|HỢP ĐỒNG FUJI CHẤP NHẬN/i)).toBeVisible({ timeout: 5000 });

    // 3. Check Block 3 Terminal Commands
    await expect(page.locator('#block3-heading')).toBeVisible();
    await expect(page.getByText(/cast call 0x20451c1e2dCD83F166B4f22868BAdECb5868d545/).first()).toBeVisible();

    // 4. Check Block 4 Resources & Known Limits
    await expect(page.locator('#block4-heading')).toBeVisible();
    await expect(page.getByText(/Pitch Deck|Slide Thuyết Trình/i)).toBeVisible();
    await expect(page.getByText(/Fuji On-Chain Evidence|Bằng Chứng Fuji/i)).toBeVisible();
    await expect(page.getByText(/Deployed Fuji Bytecode/i)).toBeVisible();
  });
});
