import { TokenClaims } from './auth';
import { toolCatalog } from './tools';
import { isValidAddress, normalizeAddress } from './chain';
import {
  TaintRegistry,
  isPolicyChangeAttempt,
  validateTreasuryProposal,
  type ProposalKind,
  type Provenance,
  type BaseProposal,
  type ToolPurchaseProposal,
  type TreasuryPayoutProposal,
  type Proposal,
  type ValidationResult,
  type ValidationRuleId,
} from '@missionpay/guard';

export {
  TaintRegistry,
  isPolicyChangeAttempt,
  validateTreasuryProposal,
};
export type {
  ProposalKind,
  Provenance,
  BaseProposal,
  ToolPurchaseProposal,
  TreasuryPayoutProposal,
  Proposal,
  ValidationResult,
  ValidationRuleId,
};

export interface ValidationContext {
  tokenClaims: TokenClaims;
  systemPaused: boolean;
  maintenance: boolean;
  stage: 'S1' | 'S2';
  mission: {
    slug: string;
    missionId: string;
    status: string;
    expiresAt: Date;
    ownerAddress: string;
    agentAddress: string;
    toolCap: bigint;
    spentTool: bigint;
    reservedTool: bigint;
    treasuryCap: bigint;
    configVersion: number;
    payeeRoot?: string;
  };
  treasuryAllowlist?: string[];
  ownerSignedPayees?: (string | { address: string; maxAtomic?: string | bigint })[];
  taintRegistry?: TaintRegistry;
  erc8004VerifiedPayees?: string[];
  disableProvenanceForEval?: boolean;
}

export function computeProposalProvenance(
  proposal: Proposal,
  ctx: ValidationContext
): {
  toProvenance?: Provenance;
  amountProvenance: Provenance;
} {
  let amountProvenance: Provenance = 'LLM';
  const rawAmt = proposal.amount_atomic;
  const isTaintedAmt = ctx.taintRegistry?.isAmountTainted(rawAmt);

  const isCatalogPrice = Object.values(toolCatalog).some(
    (t) => t.priceAtomic.toString() === rawAmt
  );
  const isMissionAuthorizedAmount =
    ctx.mission.toolCap.toString() === rawAmt ||
    ctx.mission.treasuryCap.toString() === rawAmt;

  if (isTaintedAmt && !isCatalogPrice && !isMissionAuthorizedAmount) {
    amountProvenance = 'TOOL_OUTPUT';
  } else if (isCatalogPrice || isMissionAuthorizedAmount) {
    amountProvenance = 'OWNER_MISSION';
  }

  if (proposal.kind === 'treasury_payout') {
    const normTo = normalizeAddress(proposal.to).toLowerCase();

    // 1. Owner-signed payee set takes highest precedence
    // S2-E5: Support payee entries with owner-signed maxAtomic limits
    const rawList = ctx.ownerSignedPayees || ctx.treasuryAllowlist || [];
    const ownerPayeeEntries = rawList.map((item: any) => {
      if (typeof item === 'string') {
        return { address: normalizeAddress(item).toLowerCase(), maxAtomic: undefined };
      }
      return {
        address: normalizeAddress(item.address).toLowerCase(),
        maxAtomic: item.maxAtomic !== undefined ? BigInt(item.maxAtomic.toString()) : undefined,
      };
    });

    const matchedEntry = ownerPayeeEntries.find((entry) => entry.address === normTo);
    if (matchedEntry) {
      if (matchedEntry.maxAtomic !== undefined) {
        const propAmt = BigInt(proposal.amount_atomic);
        if (propAmt <= matchedEntry.maxAtomic) {
          amountProvenance = 'OWNER_MISSION';
        } else {
          amountProvenance = 'TOOL_OUTPUT';
        }
      }
      return { toProvenance: 'OWNER_MISSION', amountProvenance };
    }

    // 2. ERC-8004 verified identity (on Fuji LIVE only, MOCK returns unverified)
    if (
      ctx.erc8004VerifiedPayees?.map((a) => normalizeAddress(a).toLowerCase()).includes(normTo) &&
      process.env.PAYMENT_MODE === 'LIVE_FUJI'
    ) {
      return { toProvenance: 'ERC8004_VERIFIED', amountProvenance };
    }

    // 3. Taint registry
    if (ctx.taintRegistry?.isAddressTainted(normTo)) {
      const src = ctx.taintRegistry.getAddressSource(normTo) || 'TOOL_OUTPUT';
      return { toProvenance: src, amountProvenance };
    }

    // 4. Default LLM
    return { toProvenance: 'LLM', amountProvenance };
  }

  return { amountProvenance };
}

export function validateProposalSchema(raw: any): {
  valid: boolean;
  error?: string;
  proposal?: Proposal;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Proposal must be an object' };
  }

  // Spec PV-2: Mọi trường provenance đến từ request body đều bị bỏ qua / không chấp nhận từ client
  const rawCopy: any = { ...raw };
  delete rawCopy.provenance;

  // Strict: reject unexpected keys
  const allowedToolKeys = new Set(['kind', 'mission_id', 'tool_id', 'amount_atomic', 'reason', 'arguments']);
  const allowedTreasuryKeys = new Set(['kind', 'mission_id', 'to', 'amount_atomic', 'reason', 'arguments']);

  if (rawCopy.kind === 'tool_purchase') {
    for (const k of Object.keys(rawCopy)) {
      if (!allowedToolKeys.has(k)) {
        return { valid: false, error: `Unknown key '${k}' in tool_purchase proposal` };
      }
    }
  } else if (rawCopy.kind === 'treasury_payout') {
    for (const k of Object.keys(rawCopy)) {
      if (!allowedTreasuryKeys.has(k)) {
        return { valid: false, error: `Unknown key '${k}' in treasury_payout proposal` };
      }
    }
  } else {
    return { valid: false, error: "Invalid kind: must be 'tool_purchase' or 'treasury_payout'" };
  }

  // Reason checks: UTF-8 <= 200 bytes, no newline or control characters (04 §1)
  if (typeof raw.reason !== 'string') {
    return { valid: false, error: 'reason must be a string' };
  }
  const reasonBytes = Buffer.from(raw.reason, 'utf8');
  if (reasonBytes.length === 0 || reasonBytes.length > 200) {
    return { valid: false, error: 'reason length must be between 1 and 200 UTF-8 bytes' };
  }
  if (/[\r\n\x00-\x1F\x7F]/.test(raw.reason)) {
    return { valid: false, error: 'reason cannot contain newlines or control characters' };
  }

  // amount_atomic positive integer string <= uint256
  if (typeof raw.amount_atomic !== 'string' || !/^\d+$/.test(raw.amount_atomic)) {
    return { valid: false, error: 'amount_atomic must be a positive integer decimal string' };
  }
  try {
    const amt = BigInt(raw.amount_atomic);
    if (amt <= 0n) {
      return { valid: false, error: 'amount_atomic must be > 0' };
    }
    const maxUint256 = (1n << 256n) - 1n;
    if (amt > maxUint256) {
      return { valid: false, error: 'amount_atomic exceeds uint256 max' };
    }
  } catch {
    return { valid: false, error: 'Invalid amount_atomic integer' };
  }

  if (raw.kind === 'tool_purchase') {
    if (typeof raw.tool_id !== 'string') {
      return { valid: false, error: 'tool_id must be a string' };
    }
    if (!raw.arguments || typeof raw.arguments !== 'object' || Array.isArray(raw.arguments)) {
      return { valid: false, error: 'arguments must be an object' };
    }
  } else if (raw.kind === 'treasury_payout') {
    if (typeof raw.to !== 'string' || !isValidAddress(raw.to)) {
      return { valid: false, error: 'to must be a valid full EVM address' };
    }
  }

  return { valid: true, proposal: rawCopy as Proposal };
}

export function validateProposal(proposal: Proposal, ctx: ValidationContext): ValidationResult {
  // Step 0: Compute server-side provenance & detect policy tamper attempts (PV-2)
  const { toProvenance, amountProvenance } = computeProposalProvenance(proposal, ctx);

  // S2-E7: Evaluation flag disableProvenanceForEval is strictly active only when MISSIONPAY_EVAL === '1'
  const isEvalProvenanceDisabled = Boolean(
    ctx.disableProvenanceForEval && process.env.MISSIONPAY_EVAL === '1'
  );

  if (!isEvalProvenanceDisabled && isPolicyChangeAttempt(proposal)) {
    return {
      outcome: 'BLOCK',
      rule: 'AGENT_CANNOT_CHANGE_POLICY',
      reason: 'Agents have no API to modify policy and are forbidden from modifying caps, allowlists, payee roots, or pause state (flagged policy change intent)',
      toProvenance,
      amountProvenance,
    };
  }

  // Step 1: Schema / kind / stage check (04 §2)
  if (proposal.kind === 'treasury_payout' && ctx.stage === 'S1') {
    return {
      outcome: 'BLOCK',
      rule: 'STAGE_S1_NO_TREASURY',
      reason: 'Treasury payouts are not available in stage S1',
      toProvenance,
      amountProvenance,
    };
  }

  // Step 2: Spend credential verification
  if (ctx.tokenClaims.type !== 'spend') {
    return {
      outcome: 'BLOCK',
      rule: 'INVALID_CREDENTIAL_TYPE',
      reason: 'Token type must be spend, read tokens cannot propose purchases',
      toProvenance,
      amountProvenance,
    };
  }
  if (ctx.tokenClaims.missionSlug !== ctx.mission.slug || ctx.tokenClaims.missionId !== ctx.mission.missionId) {
    return {
      outcome: 'BLOCK',
      rule: 'CREDENTIAL_MISSION_MISMATCH',
      reason: 'Token mission does not match targeted mission',
      toProvenance,
      amountProvenance,
    };
  }
  if (proposal.mission_id !== ctx.mission.slug && proposal.mission_id !== ctx.mission.missionId) {
    return {
      outcome: 'BLOCK',
      rule: 'PROPOSAL_MISSION_MISMATCH',
      reason: 'Proposal mission_id does not match context mission',
      toProvenance,
      amountProvenance,
    };
  }
  if (ctx.tokenClaims.stage !== ctx.stage) {
    return {
      outcome: 'BLOCK',
      rule: 'STAGE_MISMATCH',
      reason: `Token stage ${ctx.tokenClaims.stage} does not match active stage ${ctx.stage}`,
      toProvenance,
      amountProvenance,
    };
  }
  if (ctx.tokenClaims.missionConfigVersion !== ctx.mission.configVersion) {
    return {
      outcome: 'BLOCK',
      rule: 'CONFIG_VERSION_REVOKED',
      reason: 'Token configVersion revoked by mission configuration change',
      toProvenance,
      amountProvenance,
    };
  }

  // Step 3: Mission status and expiry
  if (ctx.mission.status !== 'ACTIVE') {
    return {
      outcome: 'BLOCK',
      rule: ctx.mission.status === 'PAUSED' ? 'MISSION_PAUSED' : 'MISSION_NOT_ACTIVE',
      reason: `Mission is ${ctx.mission.status}`,
      toProvenance,
      amountProvenance,
    };
  }
  if (new Date() >= ctx.mission.expiresAt) {
    return {
      outcome: 'BLOCK',
      rule: 'MISSION_EXPIRED',
      reason: 'Mission has expired',
      toProvenance,
      amountProvenance,
    };
  }

  // Step 4: System paused / maintenance
  if (ctx.systemPaused) {
    return {
      outcome: 'BLOCK',
      rule: 'SYSTEM_PAUSED',
      reason: 'System is paused',
      toProvenance,
      amountProvenance,
    };
  }
  if (ctx.maintenance) {
    return {
      outcome: 'BLOCK',
      rule: 'SYSTEM_MAINTENANCE',
      reason: 'System is under maintenance cutover',
      toProvenance,
      amountProvenance,
    };
  }

  const amount = BigInt(proposal.amount_atomic);

  // Step 5: Treasury checks (if S2) - Single source of truth via @missionpay/guard
  if (proposal.kind === 'treasury_payout') {
    const treasuryResult = validateTreasuryProposal(
      proposal,
      {
        missionId: ctx.mission.missionId,
        payees: ctx.ownerSignedPayees,
        payeeRoot: ctx.mission.payeeRoot,
        hasPayeeRoot: Boolean(
          ctx.mission.payeeRoot &&
          ctx.mission.payeeRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000'
        ),
        globalAllowlist: ctx.treasuryAllowlist,
        agentAddress: ctx.mission.agentAddress,
        caps: {
          missionCapAtomic: ctx.mission.treasuryCap,
          toolCapAtomic: ctx.mission.toolCap,
          perTxCapAtomic: 5_000_000n,
        },
        isSystemPaused: ctx.systemPaused,
        disableProvenance: isEvalProvenanceDisabled,
      },
      ctx.taintRegistry
    );

    return {
      outcome: treasuryResult.outcome,
      rule: treasuryResult.rule,
      reason: treasuryResult.reason,
      toProvenance: treasuryResult.toProvenance || toProvenance,
      amountProvenance: treasuryResult.amountProvenance || amountProvenance,
    };
  }

  // Step 6: Tool catalog and price verification
  const tool = toolCatalog[proposal.tool_id];
  if (!tool) {
    return {
      outcome: 'BLOCK',
      rule: 'UNKNOWN_TOOL',
      reason: `Tool '${proposal.tool_id}' not found in catalog`,
      toProvenance,
      amountProvenance,
    };
  }
  if (amount !== tool.priceAtomic) {
    return {
      outcome: 'BLOCK',
      rule: 'PRICE_MISMATCH',
      reason: `Proposal price ${amount} does not match catalog price ${tool.priceAtomic}`,
      toProvenance,
      amountProvenance,
    };
  }

  // Step 7: Tool argument validation and budget limits
  const argValidation = tool.validateInput(proposal.arguments);
  if (!argValidation.valid) {
    return {
      outcome: 'BLOCK',
      rule: 'INVALID_TOOL_ARGUMENTS',
      reason: argValidation.error || 'Invalid arguments for tool',
      toProvenance,
      amountProvenance,
    };
  }

  if (amount > tool.perCallCap) {
    return {
      outcome: 'BLOCK',
      rule: 'OVER_PER_CALL_CAP',
      reason: 'Amount exceeds per-call limit for tool',
      toProvenance,
      amountProvenance,
    };
  }

  const availableToolBudget = ctx.mission.toolCap - ctx.mission.spentTool - ctx.mission.reservedTool;
  if (amount > availableToolBudget) {
    return {
      outcome: 'BLOCK',
      rule: 'INSUFFICIENT_TOOL_BUDGET',
      reason: `Required ${amount} exceeds available tool budget ${availableToolBudget}`,
      toProvenance,
      amountProvenance,
    };
  }

  return {
    outcome: 'PASS',
    canonicalArguments: argValidation.canonicalInput,
    toProvenance,
    amountProvenance,
  };
}

/**
 * P2-PRICE Security Guard: Verifies an incoming 402 Quote against the official tool catalog
 * and per-call spending caps to prevent malicious/inflated resource quotes.
 */
export function verifyQuoteAgainstCatalog(params: {
  toolId: string;
  quotedAmountAtomic: bigint;
}): { valid: boolean; rule?: string; reason?: string } {
  const tool = toolCatalog[params.toolId];
  if (!tool) {
    return {
      valid: false,
      rule: 'UNKNOWN_TOOL',
      reason: `Tool '${params.toolId}' not found in catalog`,
    };
  }
  if (params.quotedAmountAtomic > tool.priceAtomic) {
    return {
      valid: false,
      rule: 'PRICE_MISMATCH',
      reason: `Quote price ${params.quotedAmountAtomic} exceeds catalog price ${tool.priceAtomic}`,
    };
  }
  if (params.quotedAmountAtomic > tool.perCallCap) {
    return {
      valid: false,
      rule: 'OVER_PER_CALL_CAP',
      reason: `Quote price ${params.quotedAmountAtomic} exceeds per-call cap ${tool.perCallCap}`,
    };
  }
  return { valid: true };
}
