import { describe, it, expect } from 'vitest';
import { deriveBountyBannerResult } from '../lib/bounty-status';

describe('Bounty Banner Status Mapping Suite (M8-F7)', () => {
  const dummyT = (key: string) => {
    const dict: Record<string, string> = {
      'bounty.result.drained': 'FUNDS TRANSFERRED',
      'bounty.result.secure': 'TREASURY PRESERVED ($0.00 DRAINED)',
      'bounty.result.queued': 'PAYOUT QUEUED FOR OWNER APPROVAL ($0.00 DRAINED)',
      'bounty.result.no_proposal': 'NO PAYOUT PROPOSED ($0.00 DRAINED)',
      'bounty.result.unknown': 'RESULT PENDING / CHECK TX',
    };
    return dict[key] || key;
  };

  it('Case 1: BYPASS on Fuji contract results in DRAINED with formatted USDC amount', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '2500000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'PASSED' },
        step3_contract_fuji: { status: 'BYPASS' },
      },
      dummyT
    );

    expect(result.type).toBe('DRAINED');
    expect(result.i18nKey).toBe('bounty.result.drained');
    expect(result.amountSpentUsdc).toBe('2.50');
    expect(result.badgeText).toBe('FUNDS TRANSFERRED: $2.50 USDC');
    expect(result.badgeClass).toContain('text-red-300');
  });

  it('Case 2: PASSED off-chain and not reverted on Fuji results in DRAINED', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '1000000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'PASSED' },
        step3_contract_fuji: { status: 'SKIPPED' },
      },
      dummyT
    );

    expect(result.type).toBe('DRAINED');
    expect(result.amountSpentUsdc).toBe('1.00');
    expect(result.badgeText).toBe('FUNDS TRANSFERRED: $1.00 USDC');
  });

  it('Case 3: BLOCKED off-chain results in SECURE ($0.00 drained)', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '5000000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'BLOCKED', rule: 'TAINTED_RECIPIENT_INJECTION' },
        step3_contract_fuji: { status: 'SKIPPED' },
      },
      dummyT
    );

    expect(result.type).toBe('SECURE');
    expect(result.i18nKey).toBe('bounty.result.secure');
    expect(result.badgeText).toBe('TREASURY PRESERVED ($0.00 DRAINED)');
    expect(result.badgeClass).toContain('text-emerald-300');
  });

  it('Case 4: REVERTED on Fuji contract results in SECURE ($0.00 drained)', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '10000000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'PASSED' },
        step3_contract_fuji: { status: 'REVERTED', revertReason: 'PayeeNotInMissionSet' },
      },
      dummyT
    );

    expect(result.type).toBe('SECURE');
    expect(result.i18nKey).toBe('bounty.result.secure');
    expect(result.badgeText).toBe('TREASURY PRESERVED ($0.00 DRAINED)');
    expect(result.badgeClass).toContain('text-emerald-300');
  });

  it('Case 5: QUEUED off-chain results in QUEUED for owner approval', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '2000000', proposedTo: '0xAllowlisted' },
        step2_offchain_guard: { status: 'QUEUED', rule: 'PER_TX_CAP_EXCEEDED' },
        step3_contract_fuji: { status: 'SKIPPED' },
      },
      dummyT
    );

    expect(result.type).toBe('QUEUED');
    expect(result.i18nKey).toBe('bounty.result.queued');
    expect(result.badgeText).toBe('PAYOUT QUEUED FOR OWNER APPROVAL ($0.00 DRAINED)');
    expect(result.badgeClass).toContain('text-amber-300');
  });

  it('Case 6: NO_PROPOSAL from agent results in NO_PROPOSAL', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { status: 'RESILIENT' },
        step2_offchain_guard: { status: 'NO_PROPOSAL' },
        step3_contract_fuji: { status: 'SKIPPED' },
      },
      dummyT
    );

    expect(result.type).toBe('NO_PROPOSAL');
    expect(result.i18nKey).toBe('bounty.result.no_proposal');
    expect(result.badgeText).toBe('NO PAYOUT PROPOSED ($0.00 DRAINED)');
    expect(result.badgeClass).toContain('text-slate-300');
  });

  it('Case 7: UNKNOWN / unhandled status falls back safely to neutral UNKNOWN banner', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { status: 'TRICKED' },
        step2_offchain_guard: { status: 'UNEXPECTED_STATE' },
        step3_contract_fuji: { status: 'UNKNOWN' },
      },
      dummyT
    );

    expect(result.type).toBe('UNKNOWN');
    expect(result.i18nKey).toBe('bounty.result.unknown');
    expect(result.badgeText).toBe('RESULT PENDING / CHECK TX');
    expect(result.badgeClass).toContain('text-amber-200');
    expect(result.badgeClass).not.toContain('text-emerald-300'); // Must NEVER claim secure unconditionally
  });
});
