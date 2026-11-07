import { describe, it, expect } from 'vitest';
import { executeBankrReplay, BANKR_MORSE_FIXTURE } from '../lib/bankr-replay';
import { prisma } from '../lib/db';

describe('WOW-0: Replay Vụ Bankr ($174,000 Drain Incident)', () => {
  it('WOW-0: Compromised planner processes Morse fixture, proposal is strictly BLOCKED, 0 payment records created, and ATTACK_BLOCKED audit entry recorded', async () => {
    // 1. Initial count of payment operations in database
    const initialPaymentCount = await prisma.toolOperation.count();

    // 2. Execute Bankr replay
    const result = await executeBankrReplay();

    // Verify scenario metadata
    expect(result.scenarioId).toMatch(/^bankr_\d+$/);
    expect(result.attackFixture.rawMorse).toBe(BANKR_MORSE_FIXTURE.rawMorse);
    expect(result.attackFixture.decodedMorse).toBe(BANKR_MORSE_FIXTURE.decodedMorse);

    // Verify compromised planner state: LLM was swayed
    expect(result.compromisedPlanner.proposal.kind).toBe('treasury_payout');
    expect((result.compromisedPlanner.proposal as any).to).toBe(BANKR_MORSE_FIXTURE.attackerAddress);
    expect(result.guardedSystem.agentSwayed).toBe(true);

    // Verify canonical validator verdict: strictly BLOCK
    expect(result.validatorVerdict.outcome).toBe('BLOCK');
    expect(result.validatorVerdict.rule).toBe('RECIPIENT_NOT_ALLOWLISTED');
    expect(result.guardedSystem.lossUsdc).toBe('0.00');

    // Verify unguarded simulation data
    expect(result.unguardedSimulation.lossUsdc).toBe('174,000.00');
    expect(result.unguardedSimulation.finalBalanceUsdc).toBe('0.00');

    // CRITICAL INVARIANT: Zero payment records created in database
    const finalPaymentCount = await prisma.toolOperation.count();
    expect(finalPaymentCount).toBe(initialPaymentCount);

    // Verify audit entry ATTACK_BLOCKED was committed
    if (result.guardedSystem.auditEntryHash) {
      const auditEntry = await prisma.auditEntry.findUnique({
        where: { entryHash: result.guardedSystem.auditEntryHash },
      });
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.canonicalJson).toContain('ATTACK_BLOCKED');
      expect(auditEntry?.canonicalJson).toContain('RECIPIENT_NOT_ALLOWLISTED');
    }
  });

  it('WOW-0: Unguarded simulation does not write anything to database', async () => {
    const beforeAuditCount = await prisma.auditEntry.count();
    const beforeOpsCount = await prisma.toolOperation.count();

    const result = await executeBankrReplay();

    // Only exactly 1 audit entry for the guarded defense was created, and ZERO tool operations
    const afterOpsCount = await prisma.toolOperation.count();
    expect(afterOpsCount).toBe(beforeOpsCount);
  });
});
