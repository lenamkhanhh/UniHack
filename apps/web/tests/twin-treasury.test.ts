import { describe, it, expect } from 'vitest';
import { GET } from '../app/api/arena/twin/route';
import {
  FUJI_GUARDED_TREASURY_ADDRESS,
  KNOWN_ALLOWLISTED_VENDOR,
  MISSION_A_ID,
  MISSION_B_ID,
  POISONED_PAYOUT_AMOUNT,
  runTwinTreasury,
} from '../../../scripts/twin-treasury';
import fs from 'fs';
import path from 'path';

describe('Twin Treasury Verification & Route Tests (P1-A)', () => {
  it('verifies constant architecture parameters for Twin Treasury', () => {
    expect(FUJI_GUARDED_TREASURY_ADDRESS.toLowerCase()).toBe(
      '0x20451c1e2dCD83F166B4f22868BAdECb5868d545'.toLowerCase()
    );
    expect(KNOWN_ALLOWLISTED_VENDOR.toLowerCase()).toBe(
      '0x1111111111111111111111111111111111111111'.toLowerCase()
    );
    expect(MISSION_A_ID).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(MISSION_B_ID).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(POISONED_PAYOUT_AMOUNT).toBe(10_000n); // 0.01 USDC (6 decimals)
  });

  it('runs twin-treasury dry-run simulation on Fuji and verifies PayeeNotInMissionSet revert on Mission B', async () => {
    const report = await runTwinTreasury({ dryRun: true });

    expect(report.mode).toBe('dry-run');
    expect(report.isVendorAllowlisted).toBe(true);
    expect(report.missionA.simulationOutcome).toBe('SUCCESS');
    expect(report.missionB.simulationOutcome).toBe('REVERT');
    expect(report.missionB.revertReason).toContain('PayeeNotInMissionSet');

    // Planned transactions check
    expect(report.plannedTransactions).toHaveLength(3);
    expect(report.totalUsdcBudget).toBe('0.01 USDC');
  }, 30000);

  it('verifies /api/arena/twin returns NOT_RUN when no evidence file exists', async () => {
    // Ensure no twin.json exists
    const evidencePath = path.resolve(process.cwd(), '../../evidence/twin/twin.json');
    const localEvidencePath = path.resolve(process.cwd(), 'evidence/twin/twin.json');
    const fileExisted = fs.existsSync(evidencePath) || fs.existsSync(localEvidencePath);

    if (!fileExisted) {
      const response = await GET();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.exists).toBe(false);
      expect(json.status).toBe('NOT_RUN');
    }
  });

  it('verifies /api/arena/twin returns RECORDED data when evidence file is present', async () => {
    const tempDir = path.resolve(process.cwd(), '../../evidence/twin');
    const tempFile = path.join(tempDir, 'twin.json');
    const hadTempFile = fs.existsSync(tempFile);

    try {
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        tempFile,
        JSON.stringify({
          contractAddress: FUJI_GUARDED_TREASURY_ADDRESS,
          mode: 'mock-test',
          status: 'TEST_RECORD',
        }),
        'utf8'
      );

      const response = await GET();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.exists).toBe(true);
      expect(json.status).toBe('RECORDED');
      expect(json.data.status).toBe('TEST_RECORD');
    } finally {
      if (!hadTempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});
