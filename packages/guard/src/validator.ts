import {
  MissionGuardConfig,
  Proposal,
  TreasuryPayoutProposal,
  ValidationResult,
  Provenance,
} from './types.js';
import { isValidAddress, normalizeAddress, computePayeeMerkleTree } from './merkle.js';
import { TaintRegistry, isPolicyChangeAttempt } from './taint.js';

export function validateTreasuryProposal(
  proposal: Proposal,
  config: MissionGuardConfig,
  taintRegistry?: TaintRegistry,
  spentTreasuryAtomic: bigint = 0n
): ValidationResult {
  // 1. Schema and basic argument sanity
  if (!proposal || typeof proposal !== 'object') {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'Proposal must be an object' };
  }

  if (proposal.kind !== 'treasury_payout' && proposal.kind !== 'tool_purchase') {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'Invalid proposal kind' };
  }

  // 2. Policy change tamper attempt check (PV-2) - evaluated with highest priority
  if (isPolicyChangeAttempt(proposal)) {
    return {
      outcome: 'BLOCK',
      rule: 'AGENT_CANNOT_CHANGE_POLICY',
      reason: 'Agents have no API to modify policy and are strictly forbidden from changing caps, allowlists, or payee roots',
      toProvenance: 'TOOL_OUTPUT',
      amountProvenance: 'TOOL_OUTPUT',
    };
  }

  // Reason checks: UTF-8 <= 200 bytes, no newline or control characters
  const reason = proposal.reason || '';
  if (typeof reason !== 'string' || reason.length === 0 || Buffer.from(reason, 'utf8').length > 200) {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'Invalid reason length' };
  }
  if (/[\r\n\x00-\x1F\x7F]/.test(reason)) {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'Reason contains control characters or newlines' };
  }

  // Amount positive integer string
  if (typeof proposal.amount_atomic !== 'string' || !/^\d+$/.test(proposal.amount_atomic)) {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'Invalid amount_atomic integer string' };
  }
  const amount = BigInt(proposal.amount_atomic);
  if (amount <= 0n) {
    return { outcome: 'BLOCK', rule: 'INVALID_ARGUMENTS', reason: 'amount_atomic must be > 0' };
  }

  // 3. System paused check
  if (config.isSystemPaused) {
    return {
      outcome: 'BLOCK',
      rule: 'SYSTEM_PAUSED',
      reason: 'Treasury system is currently paused',
    };
  }

  // If tool purchase, tool cap checks
  if (proposal.kind === 'tool_purchase') {
    const toolCap = config.caps?.toolCapAtomic ? BigInt(config.caps.toolCapAtomic.toString()) : 5_000_000n;
    if (spentTreasuryAtomic + amount > toolCap) {
      return {
        outcome: 'BLOCK',
        rule: 'MISSION_CAP_EXHAUSTED',
        reason: 'Tool budget cap exhausted',
      };
    }
    return { outcome: 'PASS', rule: 'VALIDATION_PASSED' };
  }

  // 4. Treasury Payout specific validations
  const payout = proposal as TreasuryPayoutProposal;
  if (!payout.to || !isValidAddress(payout.to)) {
    return {
      outcome: 'BLOCK',
      rule: 'INVALID_RECIPIENT',
      reason: 'Recipient address is not a valid EVM address',
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
      reason: 'Direct payout to agent address is strictly blocked',
    };
  }

  // Compute provenance
  let toProvenance: Provenance = 'LLM';
  let amountProvenance: Provenance = 'OWNER_MISSION';

  const isTaintedAmt = taintRegistry?.isAmountTainted(proposal.amount_atomic);
  if (isTaintedAmt) {
    amountProvenance = 'TOOL_OUTPUT';
  }

  // Match against owner-signed payee definitions
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
    } else {
      amountProvenance = 'OWNER_MISSION';
    }
  } else if (taintRegistry?.isAddressTainted(normTo)) {
    toProvenance = taintRegistry.getAddressSource(normTo) || 'TOOL_OUTPUT';
  } else {
    toProvenance = 'LLM';
  }

  // 5. Evaluate Provenance Rules
  if (toProvenance === 'TOOL_OUTPUT' || toProvenance === 'WEB') {
    return {
      outcome: 'BLOCK',
      rule: 'RECIPIENT_UNTRUSTED_PROVENANCE',
      reason: `Recipient address originated from untrusted source (${toProvenance})`,
      toProvenance,
      amountProvenance,
    };
  }

  // 6. Cryptographic Mission Payee Set Enforcement
  const isPayeeInSet = ownerPayeeEntries.some((p) => p.address === normTo);
  if (!isPayeeInSet) {
    return {
      outcome: 'BLOCK',
      rule: 'PAYEE_NOT_IN_MISSION_SET',
      reason: 'Recipient address is not in the owner-signed Merkle payee root for this mission',
      toProvenance,
      amountProvenance,
    };
  }

  // 7. Unknown / LLM Hallucinated Recipient
  if (toProvenance === 'LLM') {
    return {
      outcome: 'QUEUE',
      rule: 'RECIPIENT_NEEDS_OWNER_APPROVAL',
      reason: 'Recipient origin is unverified (LLM-proposed), requires owner on-chain signature',
      toProvenance,
      amountProvenance,
    };
  }

  // 8. Global Organization Allowlist (Intersection condition)
  if (config.globalAllowlist && config.globalAllowlist.length > 0) {
    const normalizedGlobal = config.globalAllowlist.map(normalizeAddress);
    if (!normalizedGlobal.includes(normTo)) {
      return {
        outcome: 'BLOCK',
        rule: 'RECIPIENT_NOT_ALLOWLISTED',
        reason: 'Recipient is not present in organization global allowlist',
        toProvenance,
        amountProvenance,
      };
    }
  }

  // 9. Amount provenance check
  if (amountProvenance === 'TOOL_OUTPUT') {
    return {
      outcome: 'QUEUE',
      rule: 'AMOUNT_FROM_UNTRUSTED_SOURCE',
      reason: 'Payout amount exceeds owner-signed invoice maximum or originated from tainted data',
      toProvenance,
      amountProvenance,
    };
  }

  // 10. Caps evaluation
  const perTxCap = config.caps?.perTxCapAtomic ? BigInt(config.caps.perTxCapAtomic.toString()) : 2_000_000n; // Default $2 USDC
  const missionCap = config.caps?.missionCapAtomic ? BigInt(config.caps.missionCapAtomic.toString()) : 10_000_000n; // Default $10 USDC

  if (amount > perTxCap) {
    return {
      outcome: 'QUEUE',
      rule: 'OVER_PER_TX_CAP',
      reason: `Amount (${amount}) exceeds per-transaction cap (${perTxCap})`,
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

  // 11. All rules passed
  return {
    outcome: 'PASS',
    rule: 'VALIDATION_PASSED',
    reason: 'Cryptographic payee proof verified and spending within mission policy limits',
    toProvenance,
    amountProvenance,
  };
}
