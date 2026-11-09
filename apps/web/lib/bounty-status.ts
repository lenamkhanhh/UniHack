export type BountyBannerStatusType = 'DRAINED' | 'SECURE' | 'QUEUED' | 'NO_PROPOSAL' | 'UNKNOWN';

export interface BountyBannerResult {
  type: BountyBannerStatusType;
  i18nKey: string;
  badgeText: string;
  badgeClass: string;
  amountSpentUsdc?: string;
}

export interface BountyStepInput {
  step1_llm?: {
    amountAtomic?: string;
    proposedTo?: string;
    status?: string;
  };
  step2_offchain_guard?: {
    status?: string;
    rule?: string;
    reason?: string;
  };
  step3_contract_fuji?: {
    status?: string;
    revertReason?: string;
  };
}

/**
 * Derives the 3-step defense evaluation result banner status, badge class, and translated text.
 * Strictly prevents misleading "SECURE" claims when the status is unknown or bypassed.
 */
export function deriveBountyBannerResult(
  steps: BountyStepInput,
  t?: (key: string) => string
): BountyBannerResult {
  const guardStatus = steps?.step2_offchain_guard?.status;
  const contractStatus = steps?.step3_contract_fuji?.status;
  const amountAtomic = steps?.step1_llm?.amountAtomic;
  const amountSpentUsdc = (Number(amountAtomic || 0) / 1e6).toFixed(2);

  const translate = t || ((k: string) => k);

  const isBypassed =
    contractStatus === 'BYPASS' ||
    (guardStatus === 'PASSED' && contractStatus !== 'REVERTED');

  const isBlocked = guardStatus === 'BLOCKED' || contractStatus === 'REVERTED';
  const isQueued = guardStatus === 'QUEUED';
  const isNoProposal = guardStatus === 'NO_PROPOSAL';

  if (isBypassed) {
    return {
      type: 'DRAINED',
      i18nKey: 'bounty.result.drained',
      badgeText: `${translate('bounty.result.drained')}: $${amountSpentUsdc} USDC`,
      badgeClass:
        'text-xs font-mono text-red-300 bg-red-950/80 border border-red-800/80 px-2.5 py-1 rounded-md self-start sm:self-auto font-bold',
      amountSpentUsdc,
    };
  }

  if (isBlocked) {
    return {
      type: 'SECURE',
      i18nKey: 'bounty.result.secure',
      badgeText: translate('bounty.result.secure'),
      badgeClass:
        'text-xs font-mono text-emerald-300 bg-emerald-950/80 border border-emerald-800/80 px-2.5 py-1 rounded-md self-start sm:self-auto font-bold',
    };
  }

  if (isQueued) {
    return {
      type: 'QUEUED',
      i18nKey: 'bounty.result.queued',
      badgeText: translate('bounty.result.queued'),
      badgeClass:
        'text-xs font-mono text-amber-300 bg-amber-950/80 border border-amber-800/80 px-2.5 py-1 rounded-md self-start sm:self-auto font-bold',
    };
  }

  if (isNoProposal) {
    return {
      type: 'NO_PROPOSAL',
      i18nKey: 'bounty.result.no_proposal',
      badgeText: translate('bounty.result.no_proposal'),
      badgeClass:
        'text-xs font-mono text-slate-300 bg-slate-800/80 border border-slate-700/80 px-2.5 py-1 rounded-md self-start sm:self-auto font-bold',
    };
  }

  // Neutral fallback for unhandled / pending execution status
  return {
    type: 'UNKNOWN',
    i18nKey: 'bounty.result.unknown',
    badgeText: translate('bounty.result.unknown'),
    badgeClass:
      'text-xs font-mono text-amber-200 bg-slate-800/90 border border-amber-700/60 px-2.5 py-1 rounded-md self-start sm:self-auto font-bold',
  };
}
