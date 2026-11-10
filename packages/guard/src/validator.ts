import {
  MissionGuardConfig,
  Proposal,
  TreasuryPayoutProposal,
  ValidationResult,
  Provenance,
} from './types.js';
import { isValidAddress, normalizeAddress, isMissionIdMatch, computePayeeMerkleTree } from './merkle.js';
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

  if (!config || typeof config !== 'object') {
    return { outcome: 'BLOCK', rule: 'CONFIG_MALFORMED', reason: 'Config must be an object' };
  }

  // Config validation: if payeeRoot is provided, must be a 32-byte hex string
  if (config.payeeRoot && (!config.payeeRoot.startsWith('0x') || config.payeeRoot.length !== 66)) {
    return { outcome: 'BLOCK', rule: 'CONFIG_MALFORMED', reason: 'payeeRoot must be a 32-byte hex string' };
  }

  // 2. Canonical Mission ID / Cross-mission isolation check
  if (!proposal.mission_id) {
    return {
      outcome: 'BLOCK',
      rule: 'PROPOSAL_MISSION_MISMATCH',
      reason: 'Proposal missing mission_id',
    };
  }

  if ((config.missionId || config.missionSlug) && !isMissionIdMatch(proposal.mission_id, config.missionId, config.missionSlug)) {
    return {
      outcome: 'BLOCK',
      rule: 'PROPOSAL_MISSION_MISMATCH',
      reason: `Proposal mission_id '${proposal.mission_id}' does not match configured canonical mission '${config.missionSlug || config.missionId}'`,
    };
  }

  // 3. System paused & Mission paused / expired checks
  if (config.isSystemPaused) {
    return {
      outcome: 'BLOCK',
      rule: 'SYSTEM_PAUSED',
      reason: 'System is paused',
    };
  }

  if (config.isMissionPaused) {
    return {
      outcome: 'BLOCK',
      rule: 'MISSION_PAUSED',
      reason: 'Mission is paused on-chain',
    };
  }

  if (config.isMissionExpired) {
    return {
      outcome: 'BLOCK',
      rule: 'MISSION_EXPIRED',
      reason: 'Mission has expired',
    };
  }

  // 4. Policy change tamper attempt check (PV-2) - evaluated with highest priority
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

  // 5. Treasury Payout specific validations
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

  // 6. Compute Provenance
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

  // 7. Cryptographic Payee Root Verification (Fail-Closed)
  const isPayeeRootConfigured = Boolean(
    config.payeeRoot &&
    config.payeeRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000'
  );
  const hasPayeeRoot = config.hasPayeeRoot !== undefined ? config.hasPayeeRoot : isPayeeRootConfigured;

  if (hasPayeeRoot) {
    if (isPayeeRootConfigured) {
      // Recalculate root from supplied payees to verify integrity
      const computedTree = computePayeeMerkleTree(config.payees || []);
      if (computedTree.root.toLowerCase() !== config.payeeRoot!.toLowerCase()) {
        return {
          outcome: 'BLOCK',
          rule: 'PAYEE_NOT_IN_MISSION_SET',
          reason: `Supplied payees do not match configured on-chain Merkle root (computed: ${computedTree.root}, expected: ${config.payeeRoot}) (fail-closed)`,
          toProvenance,
          amountProvenance,
        };
      }
    }

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

  // 8. Untrusted Provenance Hard BLOCKs
  if (!config.disableProvenance) {
    if (toProvenance === 'TOOL_OUTPUT' || toProvenance === 'WEB') {
      return {
        outcome: 'BLOCK',
        rule: 'RECIPIENT_UNTRUSTED_PROVENANCE',
        reason: `Recipient address was derived from untrusted ${toProvenance} data`,
        toProvenance,
        amountProvenance,
      };
    }
  }

  // 9. Hard BLOCK checks: Global Organization Allowlist (Intersection condition)
  // Evaluated before soft QUEUE so untrusted/LLM outputs cannot bypass allowlist!
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

  // 10. Hard BLOCK checks: Mission Budget Cap Exhaustion
  // Evaluated before soft QUEUE so exceeding mission cap is strictly BLOCKED!
  const missionCap = config.caps?.missionCapAtomic ? BigInt(config.caps.missionCapAtomic.toString()) : 10_000_000n;
  if (spentTreasuryAtomic + amount > missionCap) {
    return {
      outcome: 'BLOCK',
      rule: 'MISSION_CAP_EXHAUSTED',
      reason: `Proposal exceeds total mission budget cap (${missionCap})`,
      toProvenance,
      amountProvenance,
    };
  }

  // 11. Soft QUEUE: Provenance and Per-tx Cap
  if (!config.disableProvenance) {
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

  const perTxCap = config.caps?.perTxCapAtomic ? BigInt(config.caps.perTxCapAtomic.toString()) : 5_000_000n;
  if (amount > perTxCap) {
    return {
      outcome: 'QUEUE',
      rule: 'OVER_PER_TX_CAP',
      reason: 'Amount exceeds per-tx treasury cap',
      toProvenance,
      amountProvenance,
    };
  }

  // 12. All rules passed: honest distinction between on-chain root and configured policy
  return {
    outcome: 'PASS',
    rule: 'VALIDATION_PASSED',
    reason: isPayeeRootConfigured
      ? 'Cryptographic payee proof verified against on-chain Merkle root and spending within mission policy limits'
      : 'Configured policy check passed (no on-chain Merkle root configured) and spending within mission policy limits',
    toProvenance,
    amountProvenance,
  };
}
