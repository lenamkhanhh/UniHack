import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import { GET } from '../app/api/arena/twin/route';
import {
  FUJI_GUARDED_TREASURY_ADDRESS,
  FUJI_USDC_ADDRESS,
  OWNER_ADDRESS,
  MISSION_A_ID,
  MISSION_B_ID,
  POISONED_PAYOUT_AMOUNT,
  LEGIT_PAYOUT_AMOUNT,
  getDerivedAccounts,
  hashLeaf,
  verifyMerkle,
  runTwinTreasury,
  generateOwnerCalldataList,
} from '../../../scripts/twin-treasury';
import fs from 'fs';
import path from 'path';

// R12-F1 must not depend on live Fuji state or a real key: when `stubLiveFujiClient.active` is set,
// createPublicClient returns an in-memory client for the live preflight reads. Anvil fork tests
// (flag off) use the real viem implementation.
const stubLiveFujiClient = vi.hoisted(() => ({
  active: false,
  calls: [] as string[],
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: ((config: any) => {
      if (!stubLiveFujiClient.active) return (actual.createPublicClient as any)(config);
      const readValues: Record<string, unknown> = {
        balanceOf: 1_000_000n,
        recipientAllowlist: true,
        currentDay: 1n,
        spentOnDay: 0n,
        dailyCap: 1_000_000_000n,
        perTxCap: 5_000_000n,
        missionPayeeRoot: '0x' + '00'.repeat(32),
        missions: ['0x' + '00'.repeat(32), '0x' + '00'.repeat(20), 0n, 0n, false, false],
      };
      return {
        readContract: async ({ functionName }: { functionName: string }) => {
          stubLiveFujiClient.calls.push(functionName);
          if (!(functionName in readValues)) throw new Error(`Unexpected stubbed read: ${functionName}`);
          return readValues[functionName];
        },
        getBalance: async () => {
          stubLiveFujiClient.calls.push('getBalance');
          return 10n ** 18n;
        },
        call: async () => {
          stubLiveFujiClient.calls.push('call');
          throw new Error('eth_call must not be reached when the mock simulates success');
        },
      };
    }) as typeof actual.createPublicClient,
    createWalletClient: ((...args: any[]) => {
      if (stubLiveFujiClient.active) {
        throw new Error('Wallet client created: a transaction could be sent');
      }
      return (actual.createWalletClient as any)(...args);
    }) as typeof actual.createWalletClient,
  };
});

// apps/web/evidence/twin/*.json are tracked copies for the deployed app (Vercel cwd = apps/web).
// The route prefers them, so move them aside while these tests control the repo-root files.
const LOCAL_TWIN = ['twin.live.json', 'twin.dryrun.json'].map((f) => path.resolve(process.cwd(), 'evidence/twin', f));
const localTwinBackup = new Map<string, string>();
beforeAll(() => {
  for (const f of LOCAL_TWIN) if (fs.existsSync(f)) { localTwinBackup.set(f, fs.readFileSync(f, 'utf8')); fs.unlinkSync(f); }
});
afterAll(() => {
  for (const [f, c] of localTwinBackup) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c, 'utf8'); }
});

describe('Twin Treasury Verification & Route Tests (Round 11)', () => {
  it('verifies constant architecture parameters and derived accounts (R11-F3)', () => {
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
    expect(accounts.ownerAddress.toLowerCase()).toBe(OWNER_ADDRESS.toLowerCase());
    expect(accounts.legitPayeeAddress.toLowerCase()).toBe(OWNER_ADDRESS.toLowerCase()); // R11-F3: Owner is legit payee
    expect(accounts.controlledVendorAddress.toLowerCase()).toBe(
      '0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA'.toLowerCase()
    );
    expect(accounts.agentAddress.toLowerCase()).toBe(
      '0x374b8A126FDb9e5deEc8307da385076155Af3D72'.toLowerCase()
    );
  });

  it('verifies mathematical Merkle disjunction between controlled vendor and rootB (R11-F1)', () => {
    const accounts = getDerivedAccounts();
    const rootB = hashLeaf(accounts.legitPayeeAddress); // leaf of Owner
    const vendorLeaf = hashLeaf(accounts.controlledVendorAddress);

    // Negative control: Vendor leaf cannot verify against rootB
    expect(verifyMerkle([], rootB, vendorLeaf)).toBe(false);
    expect(verifyMerkle([rootB], rootB, vendorLeaf)).toBe(false);

    // Positive control: Legit payee leaf verifies against rootB
    expect(verifyMerkle([], rootB, hashLeaf(accounts.legitPayeeAddress))).toBe(true);
  });

  it('R11-F5: generates owner calldata list with all 6 prerequisite and cleanup transactions', () => {
    const calldataList = generateOwnerCalldataList();
    expect(calldataList).toHaveLength(6);
    expect(calldataList.map((c) => c.step)).toEqual([1, 2, 3, 4, 5, 9]);

    // Check Step 1: setRecipient(vendor, true)
    expect(calldataList[0].functionName).toBe('setRecipient');
    expect(calldataList[0].calldata).toMatch(/^0xb33480ca/);

    // Check Step 9: setRecipient(vendor, false) (R11-F4)
    expect(calldataList[5].functionName).toBe('setRecipient');
    expect(calldataList[5].calldata).toMatch(/^0xb33480ca/);
    expect(calldataList[5].args[1]).toBe(false);
  });

  it('R11-F1: runs Anvil fork simulation on Fuji bytecode and asserts exact balance deltas and 9 steps', async () => {
    const report = await runTwinTreasury({ dryRun: true, forkPort: 8562 });

    expect(report.mode).toBe('dry-run');
    expect(report.forkBlockNumber).toBeGreaterThan(60_000_000);
    expect(report.perTxCapUsdc).toContain('5 USDC');

    // Mission A: Allowlist mode -> Drained
    expect(report.missionA.simulationOutcome).toBe('SUCCESS');
    expect(report.missionA.balanceDeltaUsdc).toBe('+0.01 USDC');

    // Mission B Negative Control: Reverts PayeeNotInMissionSet -> 0 USDC leaked
    expect(report.missionB.negativeControl.simulationOutcome).toBe('REVERT');
    expect(report.missionB.negativeControl.revertReason).toContain('PayeeNotInMissionSet');
    expect(report.missionB.negativeControl.balanceDeltaUsdc).toBe('0 USDC');

    // Mission B Positive Control: Legit payee paid -> +0.01 USDC (returned to Owner)
    expect(report.missionB.positiveControl.simulationOutcome).toBe('SUCCESS');
    expect(report.missionB.positiveControl.balanceDeltaUsdc).toBe('+0.01 USDC');

    // Planned transactions check (9 transactions total per R11-F4)
    expect(report.plannedTransactions).toHaveLength(9);
    expect(report.totalUsdcBudget).toBe('0.02 USDC');
  }, 45000);

  it('R11-F1 (fail test): throws critical error if Mission B negative control unexpectedly succeeds', async () => {
    await expect(
      runTwinTreasury({
        dryRun: true,
        forkPort: 8563,
        mockNegativeSuccessForTest: true,
      })
    ).rejects.toThrow('CRITICAL FAILURE: Mission B negative control did NOT revert!');
  }, 45000);

  it('R11-F2: verifies /api/arena/twin returns NOT_RUN when neither live nor dry-run file exists', async () => {
    const dryRunPath = path.resolve(process.cwd(), '../../evidence/twin/twin.dryrun.json');
    const livePath = path.resolve(process.cwd(), '../../evidence/twin/twin.live.json');
    const localDryRun = path.resolve(process.cwd(), 'evidence/twin/twin.dryrun.json');
    const localLive = path.resolve(process.cwd(), 'evidence/twin/twin.live.json');

    // Backup any files if they exist
    const dryRunBackup = fs.existsSync(dryRunPath)
      ? fs.readFileSync(dryRunPath, 'utf8')
      : null;
    const liveBackup = fs.existsSync(livePath)
      ? fs.readFileSync(livePath, 'utf8')
      : null;
    // apps/web/evidence/twin holds tracked copies used by the deployed app; back them up too.
    const localDryBackup = fs.existsSync(localDryRun) ? fs.readFileSync(localDryRun, 'utf8') : null;
    const localLiveBackup = fs.existsSync(localLive) ? fs.readFileSync(localLive, 'utf8') : null;

    try {
      if (fs.existsSync(dryRunPath)) fs.unlinkSync(dryRunPath);
      if (fs.existsSync(livePath)) fs.unlinkSync(livePath);
      if (fs.existsSync(localDryRun)) fs.unlinkSync(localDryRun);
      if (fs.existsSync(localLive)) fs.unlinkSync(localLive);

      const response = await GET();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe('NOT_RUN');
      expect(json.isLive).toBe(false);
    } finally {
      if (dryRunBackup) fs.writeFileSync(dryRunPath, dryRunBackup, 'utf8');
      if (liveBackup) fs.writeFileSync(livePath, liveBackup, 'utf8');
      if (localDryBackup) fs.writeFileSync(localDryRun, localDryBackup, 'utf8');
      if (localLiveBackup) fs.writeFileSync(localLive, localLiveBackup, 'utf8');
    }
  });

  it('R11-F2: verifies dry-run file returns SIMULATED and NEVER yields the live badge', async () => {
    const dryRunPath = path.resolve(process.cwd(), '../../evidence/twin/twin.dryrun.json');
    const livePath = path.resolve(process.cwd(), '../../evidence/twin/twin.live.json');
    const dryRunBackup = fs.existsSync(dryRunPath)
      ? fs.readFileSync(dryRunPath, 'utf8')
      : null;
    const liveBackup = fs.existsSync(livePath)
      ? fs.readFileSync(livePath, 'utf8')
      : null;

    try {
      if (fs.existsSync(livePath)) fs.unlinkSync(livePath);

      // Ensure dry-run file exists
      if (!fs.existsSync(path.dirname(dryRunPath))) {
        fs.mkdirSync(path.dirname(dryRunPath), { recursive: true });
      }
      fs.writeFileSync(
        dryRunPath,
        JSON.stringify({
          mode: 'dry-run',
          forkBlockNumber: 60995458,
          status: 'SIMULATED_TEST',
        }),
        'utf8'
      );

      const response = await GET();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe('SIMULATED');
      expect(json.isLive).toBe(false); // MUST be false
      expect(json.data.forkBlockNumber).toBe(60995458);
    } finally {
      if (dryRunBackup) fs.writeFileSync(dryRunPath, dryRunBackup, 'utf8');
      if (liveBackup) fs.writeFileSync(livePath, liveBackup, 'utf8');
    }
  });

  it('R11-F2: verifies live badge requires mode=broadcast AND 3 real transaction hashes', async () => {
    const livePath = path.resolve(process.cwd(), '../../evidence/twin/twin.live.json');
    const liveBackup = fs.existsSync(livePath) ? fs.readFileSync(livePath, 'utf8') : null;

    try {
      if (!fs.existsSync(path.dirname(livePath))) {
        fs.mkdirSync(path.dirname(livePath), { recursive: true });
      }

      // Case 1: missing hashes -> NOT LIVE
      fs.writeFileSync(
        livePath,
        JSON.stringify({
          mode: 'broadcast',
          missionA: {},
          missionB: { negativeControl: {}, positiveControl: {} },
        }),
        'utf8'
      );
      let response = await GET();
      let json = await response.json();
      expect(json.isLive).toBe(false);

      // Case 2: all 3 real hashes present -> LIVE
      fs.writeFileSync(
        livePath,
        JSON.stringify({
          mode: 'broadcast',
          missionA: { txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' },
          missionB: {
            negativeControl: { txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' },
            positiveControl: { txHash: '0x9999999999abcdef1234567890abcdef1234567890abcdef1234567890abcdef' },
          },
        }),
        'utf8'
      );
      response = await GET();
      json = await response.json();
      expect(json.status).toBe('LIVE');
      expect(json.isLive).toBe(true);
    } finally {
      if (liveBackup) {
        fs.writeFileSync(livePath, liveBackup, 'utf8');
      } else if (fs.existsSync(livePath)) {
        fs.unlinkSync(livePath);
      }
    }
  });

  it('R12-F1 (fail test): throws critical error before sending tx if eth_call unexpectedly simulates success', async () => {
    const origEnv = process.env.TWIN_ALLOW_BROADCAST;
    const origAgentKey = process.env.AGENT_PRIVATE_KEY;
    process.env.TWIN_ALLOW_BROADCAST = '1';
    // Throwaway key generated for this test only; never funded, never a well-known key.
    process.env.AGENT_PRIVATE_KEY = generatePrivateKey();
    stubLiveFujiClient.active = true;
    stubLiveFujiClient.calls.length = 0;

    try {
      await expect(
        runTwinTreasury({
          broadcast: true,
          mockEthCallSuccessForBroadcastTest: true,
        })
      ).rejects.toThrow(
        'CRITICAL PREFLIGHT FAILURE: Mission B negative control eth_call did NOT revert! Aborting broadcast before sending transactions.'
      );
      // Aborted at the preflight eth_call guard: it was never even issued, and no wallet client exists.
      expect(stubLiveFujiClient.calls).not.toContain('call');
    } finally {
      stubLiveFujiClient.active = false;
      if (origAgentKey !== undefined) {
        process.env.AGENT_PRIVATE_KEY = origAgentKey;
      } else {
        delete process.env.AGENT_PRIVATE_KEY;
      }
      if (origEnv !== undefined) {
        process.env.TWIN_ALLOW_BROADCAST = origEnv;
      } else {
        delete process.env.TWIN_ALLOW_BROADCAST;
      }
    }
  }, 30000);
});
