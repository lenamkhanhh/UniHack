import { describe, it, expect } from 'vitest';
import { deriveBountyBannerResult } from '../lib/bounty-status';

describe('Bounty Banner Status Mapping Suite (M8-F7, M8-F8, M8-F9)', () => {
  const enT = (key: string) => {
    const dict: Record<string, string> = {
      'bounty.result.drained': 'POTENTIAL BYPASS: simulated call would pay $X USDC',
      'bounty.result.secure': 'TREASURY PRESERVED ($0.00 DRAINED)',
      'bounty.result.queued': 'PAYOUT QUEUED FOR OWNER APPROVAL ($0.00 DRAINED)',
      'bounty.result.no_proposal': 'NO PAYOUT PROPOSED ($0.00 DRAINED)',
      'bounty.result.unknown': 'RESULT PENDING / CHECK TX',
    };
    return dict[key] || key;
  };

  const viT = (key: string) => {
    const dict: Record<string, string> = {
      'bounty.result.drained': 'CÓ THỂ LỌT: mô phỏng cho thấy sẽ chi $X USDC',
      'bounty.result.secure': 'BẢO TOÀN NGÂN QUỸ (THẤT THOÁT $0.00)',
      'bounty.result.queued': 'ĐỀ XUẤT ĐƯA VÀO HÀNG ĐỢI CHỦ DUYỆT (THẤT THOÁT $0.00)',
      'bounty.result.no_proposal': 'AGENT KHÔNG ĐỀ XUẤT THANH TOÁN (THẤT THOÁT $0.00)',
      'bounty.result.unknown': 'CHƯA RÕ KẾT QUẢ, XEM TX',
    };
    return dict[key] || key;
  };

  it('Case 1: BYPASS on Fuji contract + guard PASS results in DRAINED with honest POTENTIAL BYPASS wording (M8-F9)', () => {
    const resultEN = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '2500000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'PASSED' },
        step3_contract_fuji: { status: 'BYPASS' },
      },
      enT
    );

    expect(resultEN.type).toBe('DRAINED');
    expect(resultEN.i18nKey).toBe('bounty.result.drained');
    expect(resultEN.amountSpentUsdc).toBe('2.50');
    expect(resultEN.badgeText).toBe('POTENTIAL BYPASS: simulated call would pay $2.50 USDC');
    expect(resultEN.badgeClass).toContain('text-red-300');

    // Check Vietnamese translation as well
    const resultVI = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '2500000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'PASSED' },
        step3_contract_fuji: { status: 'BYPASS' },
      },
      viT
    );
    expect(resultVI.badgeText).toBe('CÓ THỂ LỌT: mô phỏng cho thấy sẽ chi $2.50 USDC');
  });

  it('Case 2: In-set payee / LLM not tricked: simulation SKIPPED does not bypass (M8-F8)', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '1000000', proposedTo: '0xAllowlisted' },
        step2_offchain_guard: { status: 'PASSED' },
        step3_contract_fuji: { status: 'SKIPPED', revertReason: 'Skipped (LLM not tricked)' },
      },
      enT
    );

    // Because simulation was skipped, it must NOT claim DRAINED
    expect(result.type).not.toBe('DRAINED');
    expect(result.type).toBe('UNKNOWN');
    expect(result.badgeText).toBe('RESULT PENDING / CHECK TX');
  });

  it('Case 3: RPC / transport error during simulation results in RPC_ERROR and neutral UNKNOWN banner (M8-F8)', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '1000000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'BLOCKED', rule: 'TAINTED_RECIPIENT_INJECTION' },
        step3_contract_fuji: { status: 'RPC_ERROR', revertReason: 'RPC_ERROR: fetch failed' },
      },
      enT
    );

    // Transport failure must never claim SECURE or DRAINED
    expect(result.type).toBe('UNKNOWN');
    expect(result.i18nKey).toBe('bounty.result.unknown');
    expect(result.badgeText).toBe('RESULT PENDING / CHECK TX');
    expect(result.badgeClass).toContain('text-amber-200');
    expect(result.badgeClass).not.toContain('text-emerald-300');
  });

  it('Case 4: Decoded contract revert (e.g. PayeeNotInMissionSet) results in SECURE ($0.00 drained)', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '10000000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'PASSED' },
        step3_contract_fuji: { status: 'REVERTED', revertReason: 'PayeeNotInMissionSet' },
      },
      enT
    );

    expect(result.type).toBe('SECURE');
    expect(result.i18nKey).toBe('bounty.result.secure');
    expect(result.badgeText).toBe('TREASURY PRESERVED ($0.00 DRAINED)');
    expect(result.badgeClass).toContain('text-emerald-300');
  });

  it('Case 5: BLOCKED off-chain results in SECURE ($0.00 drained)', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '5000000', proposedTo: '0xAttacker' },
        step2_offchain_guard: { status: 'BLOCKED', rule: 'TAINTED_RECIPIENT_INJECTION' },
        step3_contract_fuji: { status: 'REVERTED' },
      },
      enT
    );

    expect(result.type).toBe('SECURE');
    expect(result.badgeText).toBe('TREASURY PRESERVED ($0.00 DRAINED)');
  });

  it('Case 6: QUEUED off-chain results in QUEUED for owner approval', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { amountAtomic: '2000000', proposedTo: '0xAllowlisted' },
        step2_offchain_guard: { status: 'QUEUED', rule: 'PER_TX_CAP_EXCEEDED' },
        step3_contract_fuji: { status: 'SKIPPED' },
      },
      enT
    );

    expect(result.type).toBe('QUEUED');
    expect(result.i18nKey).toBe('bounty.result.queued');
    expect(result.badgeText).toBe('PAYOUT QUEUED FOR OWNER APPROVAL ($0.00 DRAINED)');
    expect(result.badgeClass).toContain('text-amber-300');
  });

  it('Case 7: NO_PROPOSAL from agent results in NO_PROPOSAL', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { status: 'RESILIENT' },
        step2_offchain_guard: { status: 'NO_PROPOSAL' },
        step3_contract_fuji: { status: 'SKIPPED' },
      },
      enT
    );

    expect(result.type).toBe('NO_PROPOSAL');
    expect(result.i18nKey).toBe('bounty.result.no_proposal');
    expect(result.badgeText).toBe('NO PAYOUT PROPOSED ($0.00 DRAINED)');
    expect(result.badgeClass).toContain('text-slate-300');
  });

  it('Case 8: UNKNOWN / unhandled status falls back safely to neutral UNKNOWN banner', () => {
    const result = deriveBountyBannerResult(
      {
        step1_llm: { status: 'TRICKED' },
        step2_offchain_guard: { status: 'UNEXPECTED_STATE' },
        step3_contract_fuji: { status: 'UNKNOWN' },
      },
      enT
    );

    expect(result.type).toBe('UNKNOWN');
    expect(result.i18nKey).toBe('bounty.result.unknown');
    expect(result.badgeText).toBe('RESULT PENDING / CHECK TX');
    expect(result.badgeClass).toContain('text-amber-200');
    expect(result.badgeClass).not.toContain('text-emerald-300'); // Must NEVER claim secure unconditionally
  });
});
