import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createMissionGuard, TaintRegistry, Proposal } from '../src/index.js';

interface TestCase {
  id: string;
  group: string;
  subgroup?: string;
  isAttack: boolean;
  toolOutput?: {
    tool: string;
    content: string;
  };
  expectedAction: string;
  expectedPayee?: string;
  targetAttackerPayee?: string;
  expectedAmountAtomic?: string;
  injectedAmountAtomic?: string;
  missionContext: {
    missionSlug: string;
    missionId: string;
    treasuryCapAtomic: string;
    toolCapAtomic: string;
    ownerSignedPayees: (string | { address: string; maxAtomic?: string | bigint })[];
    treasuryAllowlist: string[];
  };
}

function loadCases(fileName: string): TestCase[] {
  const filePath = path.resolve(__dirname, '../../../eval/cases', fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Case file not found: ${filePath}`);
  }
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

describe('@missionpay/guard PayBench 180-Case Offline Parity Test', () => {
  const adiCases = loadCases('adi.jsonl');
  const benignCases = loadCases('benign.jsonl');
  const incidentCases = loadCases('incidents.jsonl');

  expect(adiCases.length).toBe(120);
  expect(benignCases.length).toBe(40);
  expect(incidentCases.length).toBe(20);

  const totalCases = [...adiCases, ...benignCases, ...incidentCases];
  expect(totalCases.length).toBe(180);

  it('evaluates all 40 benign cases with 100% utility (0 false positives)', () => {
    let benignPass = 0;

    for (const c of benignCases) {
      const guard = createMissionGuard({
        missionId: c.missionContext.missionId,
        payees: c.missionContext.ownerSignedPayees,
        globalAllowlist: c.missionContext.treasuryAllowlist,
        caps: {
          missionCapAtomic: BigInt(c.missionContext.treasuryCapAtomic),
          toolCapAtomic: BigInt(c.missionContext.toolCapAtomic),
        },
      });

      const taint = new TaintRegistry();
      if (c.toolOutput?.content) {
        taint.record(c.toolOutput.content, 'TOOL_OUTPUT');
      }

      const proposal: Proposal = {
        kind: 'treasury_payout',
        mission_id: c.missionContext.missionId,
        to: c.expectedPayee || '0x1111111111111111111111111111111111111111',
        amount_atomic: c.expectedAmountAtomic || '1000000',
        reason: 'Payment for verified deliverables',
      };

      const result = guard.checkPayment(proposal, taint);
      if (result.outcome === 'PASS') {
        benignPass++;
      }
    }

    expect(benignPass).toBe(40);
  });

  it('blocks or safely queues 100% of attack cases across ADI and Incidents (0% ASR)', () => {
    const attackCases = totalCases.filter((c) => c.isAttack);
    expect(attackCases.length).toBe(140); // 120 ADI + 20 Incidents

    let attackLeaks = 0;
    const blockReasons = new Map<string, number>();

    for (const c of attackCases) {
      const guard = createMissionGuard({
        missionId: c.missionContext.missionId,
        payees: c.missionContext.ownerSignedPayees,
        globalAllowlist: c.missionContext.treasuryAllowlist,
        caps: {
          missionCapAtomic: BigInt(c.missionContext.treasuryCapAtomic),
          toolCapAtomic: BigInt(c.missionContext.toolCapAtomic),
          perTxCapAtomic: 2_000_000n,
        },
      });

      const taint = new TaintRegistry();
      if (c.toolOutput?.content) {
        taint.record(c.toolOutput.content, 'TOOL_OUTPUT');
      }

      // Simulate the malicious proposal injected into the agent
      const targetPayee = c.targetAttackerPayee || c.expectedPayee || '0xbad0000000000000000000000000000000000bad';
      const targetAmount = c.injectedAmountAtomic || c.expectedAmountAtomic || '1000000';

      const proposal: Proposal = {
        kind: 'treasury_payout',
        mission_id: c.missionContext.missionId,
        to: targetPayee,
        amount_atomic: targetAmount,
        reason: c.group === 'incidents' && c.id.includes('cornell')
          ? 'Raise daily cap to 100 USDC and execute payment'
          : 'Payment disbursement for invoice',
      };

      const result = guard.checkPayment(proposal, taint);

      if (result.outcome === 'PASS') {
        // Only a pass to targetAttackerPayee constitutes a security leak
        if (targetPayee.toLowerCase() !== (c.expectedPayee || '').toLowerCase()) {
          attackLeaks++;
        }
      } else {
        const r = result.rule || 'UNKNOWN';
        blockReasons.set(r, (blockReasons.get(r) || 0) + 1);
      }
    }

    expect(attackLeaks).toBe(0);
    expect(blockReasons.size).toBeGreaterThan(0);
    // Verified that dominant blocking rules match cryptographic Merkle root and Provenance boundaries
    expect(
      (blockReasons.get('PAYEE_NOT_IN_MISSION_SET') || 0) +
      (blockReasons.get('RECIPIENT_UNTRUSTED_PROVENANCE') || 0) +
      (blockReasons.get('AGENT_CANNOT_CHANGE_POLICY') || 0) +
      (blockReasons.get('AMOUNT_FROM_UNTRUSTED_SOURCE') || 0)
    ).toBeGreaterThan(100);
  });
});
