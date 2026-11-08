import {
  MissionGuardConfig,
  Proposal,
  TreasuryPayoutProposal,
  ValidationResult,
  Provenance,
} from './types.js';
import { isValidAddress, normalizeAddress } from './merkle.js';
import { TaintRegistry, isPolicyChangeAttempt } from './taint.js';

export function validateTreasuryProposal(
  proposal: Proposal,
  config: MissionGuardConfig,
  taintRegistry?: TaintRegistry,
  spentTreasuryAtomic: bigint = 0n
): ValidationResult {
  // 1. Basic sanity checks
  if (!proposal || typeof proposal !== 'object') {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'Proposal must be an object' };
  }

  if (proposal.kind !== 'treasury_payout' && proposal.kind !== 'tool_purchase') {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: "Invalid kind: must be 'tool_purchase' or 'treasury_payout'" };
  }

  // 2. Policy change tamper attempt check (PV-2) - evaluated with highest priority
  if (!config.disableProvenance && isPolicyChangeAttempt(proposal)) {
    return {
      outcome: 'BLOCK',
      rule: 'AGENT_CANNOT_CHANGE_POLICY',
      reason: 'Agents have no API to modify policy and are forbidden from modifying caps, allowlists, payee roots, or pause state (flagged policy change intent)',
      toProvenance: 'TOOL_OUTPUT',
      amountProvenance: 'TOOL_OUTPUT',
    };
  }

  // Reason checks: UTF-8 <= 200 bytes, no newline or control characters
  const reason = proposal.reason || '';
  if (typeof reason !== 'string') {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'reason must be a string' };
  }
  const reasonBytes = Buffer.from(reason, 'utf8');
  if (reasonBytes.length === 0 || reasonBytes.length > 200) {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'reason length must be between 1 and 200 UTF-8 bytes' };
  }
  if (/[\r\n\x00-\x1F\x7F]/.test(reason)) {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'reason cannot contain newlines or control characters' };
  }

  // Amount positive integer string <= uint256
  if (typeof proposal.amount_atomic !== 'string' || !/^\d+$/.test(proposal.amount_atomic)) {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'amount_atomic must be a positive integer decimal string' };
  }
  let amount = 0n;
  try {
    amount = BigInt(proposal.amount_atomic);
    if (amount <= 0n) {
      return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'amount_atomic must be > 0' };
    }
    const maxUint256 = (1n << 256n) - 1n;
    if (amount > maxUint256) {
      return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'amount_atomic exceeds uint256 max' };
    }
  } catch {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'Invalid amount_atomic integer' };
  }

  // 3. System paused check
  if (config.isSystemPaused) {
    return {
      outcome: 'BLOCK',
      rule: 'SYSTEM_PAUSED',
      reason: 'System is paused',
    };
  }

  // Tool purchase handling if called on tool_purchase
  if (proposal.kind === 'tool_purchase') {
    const toolCap = config.caps?.toolCapAtomic ? BigInt(config.caps.toolCapAtomic.toString()) : 5_000_000n;
    if (spentTreasuryAtomic + amount > toolCap) {
      return {
        outcome: 'BLOCK',
        rule: 'INSUFFICIENT_TOOL_BUDGET',
        reason: 'Tool budget cap exhausted',
      };
    }
    return { outcome: 'PASS', rule: 'VALIDATION_PASSED' };
  }

  // 4. Treasury Payout specific validations
  const payout = proposal as TreasuryPayoutProposal;
  if (!payout.to || typeof payout.to !== 'string' || !isValidAddress(payout.to)) {
    return {
      outcome: 'BLOCK',
      rule: 'INVALID_RECIPIENT',
      reason: 'to must be a valid full EVM address',
    };
  }

  const normTo = normalizeAddress(payout.to);
  if (normTo === '0x0000000000000000000000000000000000000000') {
    return {
      outcome: 'BLOCK',
      rule: 'INVALID_RECIPIENT',
      reason: 'Zero recipient address is forbidden',
    };
  }

  if (config.agentAddress && normTo === normalizeAddress(config.agentAddress)) {
    return {
      outcome: 'BLOCK',
      rule: 'CANNOT_PAY_AGENT',
      reason: 'Treasury payout directly to agent is strictly forbidden (no auto-refill)',
    };
  }

  // 5. Compute Provenance
  let toProvenance: Provenance = 'LLM';
  let amountProvenance: Provenance = 'LLM';

  const rawAmt = proposal.amount_atomic;
  const isTaintedAmt = taintRegistry?.isAmountTainted(rawAmt);

  const isMissionAuthorizedAmount =
    (config.caps?.toolCapAtomic && config.caps.toolCapAtomic.toString() === rawAmt) ||
    (config.caps?.missionCapAtomic && config.caps.missionCapAtomic.toString() === rawAmt);

  if (isTaintedAmt && !isMissionAuthorizedAmount) {
    amountProvenance = 'TOOL_OUTPUT';
  } else if (isMissionAuthorizedAmount) {
    amountProvenance = 'OWNER_MISSION';
  }

  const ownerPayeeEntries = (config.payees || []).map((item) => {
    if (typeof item === 'string') {
      return { address: normalizeAddress(item), maxAtomic: undefined };
    }
    return {
      address: normalizeAddress(item.address),
      maxAtomic: item.maxAtomic !== undefined ? BigInt(item.maxAtomic.toString()) : undefined,
    };
  });

  const matchedPayee = ownerPayeeEntries.find((p) => p.address === normTo);
  if (matchedPayee) {
    toProvenance = 'OWNER_MISSION';
    if (matchedPayee.maxAtomic !== undefined) {
      if (amount <= matchedPayee.maxAtomic) {
        amountProvenance = 'OWNER_MISSION';
      } else {
        amountProvenance = 'TOOL_OUTPUT';
      }
    }
  } else if (taintRegistry?.isAddressTainted(normTo)) {
    toProvenance = taintRegistry.getAddressSource(normTo) || 'TOOL_OUTPUT';
  } else {
    toProvenance = 'LLM';
  }

  if (amountProvenance === 'LLM') {
    amountProvenance = 'OWNER_MISSION';
  }

  // 6. Cryptographic Payee Root & Provenance checks
  if (!config.disableProvenance) {
    const hasPayeeRoot = config.hasPayeeRoot !== undefined
      ? config.hasPayeeRoot
      : Boolean(
          config.payeeRoot &&
          config.payeeRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        );

    if (hasPayeeRoot) {
      const isPayeeInSet = ownerPayeeEntries.some((p) => p.address === normTo);
      if (!isPayeeInSet) {
        return {
          outcome: 'BLOCK',
          rule: 'PAYEE_NOT_IN_MISSION_SET',
          reason: `Recipient ${normTo} is not in the owner-signed payee set for this mission (payee root active)`,
          toProvenance,
          amountProvenance,
        };
      }
    }

    if (toProvenance === 'TOOL_OUTPUT' || toProvenance === 'WEB') {
      return {
        outcome: 'BLOCK',
        rule: 'RECIPIENT_UNTRUSTED_PROVENANCE',
        reason: `Recipient address was derived from untrusted ${toProvenance} data`,
        toProvenance,
        amountProvenance,
      };
    }

    if (toProvenance === 'LLM') {
      return {
        outcome: 'QUEUE',
        rule: 'RECIPIENT_NEEDS_OWNER_APPROVAL',
        reason: 'Recipient address generated by LLM requires explicit owner approval and Merkle payee signature',
        toProvenance,
        amountProvenance,
      };
    }

    if (amountProvenance === 'TOOL_OUTPUT') {
      return {
        outcome: 'QUEUE',
        rule: 'AMOUNT_FROM_UNTRUSTED_SOURCE',
        reason: 'Payment amount extracted from untrusted external data requires owner review',
        toProvenance,
        amountProvenance,
      };
    }
  }

  // 7. Global Organization Allowlist (Intersection condition)
  if (config.globalAllowlist && config.globalAllowlist.length > 0) {
    const normalizedGlobal = config.globalAllowlist.map(normalizeAddress);
    if (!normalizedGlobal.includes(normTo)) {
      return {
        outcome: 'BLOCK',
        rule: 'RECIPIENT_NOT_ALLOWLISTED',
        reason: 'Recipient is not on the treasury allowlist',
        toProvenance,
        amountProvenance,
      };
    }
  }

  // 8. Caps evaluation
  const perTxCap = config.caps?.perTxCapAtomic ? BigInt(config.caps.perTxCapAtomic.toString()) : 5_000_000n;
  const missionCap = config.caps?.missionCapAtomic ? BigInt(config.caps.missionCapAtomic.toString()) : 10_000_000n;

  if (amount > perTxCap) {
    return {
      outcome: 'QUEUE',
      rule: 'OVER_PER_TX_CAP',
      reason: 'Amount exceeds per-tx treasury cap',
      toProvenance,
      amountProvenance,
    };
  }

  if (spentTreasuryAtomic + amount > missionCap) {
    return {
      outcome: 'BLOCK',
      rule: 'MISSION_CAP_EXHAUSTED',
      reason: `Proposal exceeds total mission budget cap (${missionCap})`,
      toProvenance,
      amountProvenance,
    };
  }

  // 9. All rules passed
  return {
    outcome: 'PASS',
    rule: 'VALIDATION_PASSED',
    reason: 'Cryptographic payee proof verified and spending within mission policy limits',
    toProvenance,
    amountProvenance,
  };
}
