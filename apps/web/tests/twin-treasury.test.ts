import { describe, it, expect } from 'vitest';
import { GET } from '../app/api/arena/twin/route';
import {
  FUJI_GUARDED_TREASURY_ADDRESS,
  FUJI_USDC_ADDRESS,
  MISSION_A_ID,
  MISSION_B_ID,
  POISONED_PAYOUT_AMOUNT,
  LEGIT_PAYOUT_AMOUNT,
  getDerivedAccounts,
  hashLeaf,
  verifyMerkle,
  runTwinTreasury,
} from '../../../scripts/twin-treasury';
import fs from 'fs';
import path from 'path';

describe('Twin Treasury Verification & Route Tests (Round 10)', () => {
  it('verifies constant architecture parameters and derived accounts', () => {
    expect(FUJI_GUARDED_TREASURY_ADDRESS.toLowerCase()).toBe(
      '0x20451c1e2dCD83F166B4f22868BAdECb5868d545'.toLowerCase()
    );
    expect(FUJI_USDC_ADDRESS.toLowerCase()).toBe(
      '0x5425890298aed601595a70AB815c96711a31Bc65'.toLowerCase()
    );
    expect(MISSION_A_ID).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(MISSION_B_ID).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(POISONED_PAYOUT_AMOUNT).toBe(10_000n); // 0.01 USDC
    expect(LEGIT_PAYOUT_AMOUNT).toBe(10_000n); // 0.01 USDC

    const accounts = getDerivedAccounts();
    expect(accounts.ownerAddress.toLowerCase()).toBe(
      '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c'.toLowerCase()
    );
    expect(accounts.agentAddress.toLowerCase()).toBe(
      '0x374b8A126FDb9e5deEc8307da385076155Af3D72'.toLowerCase()
    );
    expect(accounts.controlledVendorAddress.toLowerCase()).toBe(
      '0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA'.toLowerCase()
    );
    expect(accounts.legitPayeeAddress.toLowerCase()).toBe(
      '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5'.toLowerCase()
    );
  });

  it('R10-F1: verifies mathematical Merkle disjunction between controlled vendor and rootB', () => {
    const accounts = getDerivedAccounts();
    const rootB = hashLeaf(accounts.legitPayeeAddress);
    const vendorLeaf = hashLeaf(accounts.controlledVendorAddress);

    // Negative control: Vendor leaf cannot verify against rootB
    expect(verifyMerkle([], rootB, vendorLeaf)).toBe(false);
    expect(verifyMerkle([rootB], rootB, vendorLeaf)).toBe(false);

    // Positive control: Legit payee leaf verifies against rootB
    expect(verifyMerkle([], rootB, hashLeaf(accounts.legitPayeeAddress))).toBe(true);
  });

  it('R10-F4 & R10-F5: runs Anvil fork simulation on Fuji bytecode and verifies balance deltas', async () => {
    // Run fork simulation on isolated port 8558
    const report = await runTwinTreasury({ dryRun: true, forkPort: 8558 });

    expect(report.mode).toBe('dry-run');
    expect(report.forkBlockNumber).toBeGreaterThan(60_000_000);

    // Mission A: Allowlist mode -> Drained
    expect(report.missionA.simulationOutcome).toBe('SUCCESS');
    expect(report.missionA.balanceDeltaUsdc).toBe('+0.01 USDC');

    // Mission B Negative Control: Reverts PayeeNotInMissionSet -> 0 USDC leaked
    expect(report.missionB.negativeControl.simulationOutcome).toBe('REVERT');
    expect(report.missionB.negativeControl.revertReason).toContain('PayeeNotInMissionSet');
    expect(report.missionB.negativeControl.balanceDeltaUsdc).toBe('0 USDC');

    // Mission B Positive Control: Legit payee paid -> +0.01 USDC
    expect(report.missionB.positiveControl.simulationOutcome).toBe('SUCCESS');
    expect(report.missionB.positiveControl.balanceDeltaUsdc).toBe('+0.01 USDC');

    // Planned transactions check
    expect(report.plannedTransactions).toHaveLength(8);
    expect(report.totalUsdcBudget).toBe('0.02 USDC');
  }, 45000);

  it('verifies /api/arena/twin returns NOT_RUN when no evidence file exists', async () => {
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
