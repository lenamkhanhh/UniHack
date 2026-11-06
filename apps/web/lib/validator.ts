import { TokenClaims } from './auth';
import { toolCatalog } from './tools';
import { isValidAddress, normalizeAddress } from './chain';

export type ProposalKind = 'tool_purchase' | 'treasury_payout';

export interface BaseProposal {
  kind: ProposalKind;
  mission_id: string;
  amount_atomic: string;
  reason: string;
}

export interface ToolPurchaseProposal extends BaseProposal {
  kind: 'tool_purchase';
  tool_id: string;
  arguments: Record<string, any>;
}

export interface TreasuryPayoutProposal extends BaseProposal {
  kind: 'treasury_payout';
  to: string;
}

export type Proposal = ToolPurchaseProposal | TreasuryPayoutProposal;

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
  };
  treasuryAllowlist?: string[];
}

export interface ValidationResult {
  outcome: 'PASS' | 'BLOCK' | 'QUEUE';
  rule?: string;
  reason?: string;
  canonicalArguments?: any;
}

export function validateProposalSchema(raw: any): {
  valid: boolean;
  error?: string;
  proposal?: Proposal;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Proposal must be an object' };
  }

  // Strict: reject unexpected keys
  const allowedToolKeys = new Set(['kind', 'mission_id', 'tool_id', 'amount_atomic', 'reason', 'arguments']);
  const allowedTreasuryKeys = new Set(['kind', 'mission_id', 'to', 'amount_atomic', 'reason', 'arguments']);

  if (raw.kind === 'tool_purchase') {
    for (const k of Object.keys(raw)) {
      if (!allowedToolKeys.has(k)) {
        return { valid: false, error: `Unknown key '${k}' in tool_purchase proposal` };
      }
    }
  } else if (raw.kind === 'treasury_payout') {
    for (const k of Object.keys(raw)) {
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

  return { valid: true, proposal: raw as Proposal };
}

export function validateProposal(proposal: Proposal, ctx: ValidationContext): ValidationResult {
  // Step 1: Schema / kind / stage check (04 §2)
  if (proposal.kind === 'treasury_payout' && ctx.stage === 'S1') {
    return {
      outcome: 'BLOCK',
      rule: 'STAGE_S1_NO_TREASURY',
      reason: 'Treasury payouts are not available in stage S1',
    };
  }

  // Step 2: Spend credential verification
  if (ctx.tokenClaims.type !== 'spend') {
    return {
      outcome: 'BLOCK',
      rule: 'INVALID_CREDENTIAL_TYPE',
      reason: 'Token type must be spend, read tokens cannot propose purchases',
    };
  }
  if (ctx.tokenClaims.missionSlug !== ctx.mission.slug || ctx.tokenClaims.missionId !== ctx.mission.missionId) {
    return {
      outcome: 'BLOCK',
      rule: 'CREDENTIAL_MISSION_MISMATCH',
      reason: 'Token mission does not match targeted mission',
    };
  }
  if (proposal.mission_id !== ctx.mission.slug && proposal.mission_id !== ctx.mission.missionId) {
    return {
      outcome: 'BLOCK',
      rule: 'PROPOSAL_MISSION_MISMATCH',
      reason: 'Proposal mission_id does not match context mission',
    };
  }
  if (ctx.tokenClaims.stage !== ctx.stage) {
    return {
      outcome: 'BLOCK',
      rule: 'STAGE_MISMATCH',
      reason: `Token stage ${ctx.tokenClaims.stage} does not match active stage ${ctx.stage}`,
    };
  }
  if (ctx.tokenClaims.missionConfigVersion !== ctx.mission.configVersion) {
    return {
      outcome: 'BLOCK',
      rule: 'CONFIG_VERSION_REVOKED',
      reason: 'Token configVersion revoked by mission configuration change',
    };
  }

  // Step 3: Mission status and expiry
  if (ctx.mission.status !== 'ACTIVE') {
    return {
      outcome: 'BLOCK',
      rule: 'MISSION_NOT_ACTIVE',
      reason: `Mission is ${ctx.mission.status}`,
    };
  }
  if (new Date() >= ctx.mission.expiresAt) {
    return {
      outcome: 'BLOCK',
      rule: 'MISSION_EXPIRED',
      reason: 'Mission has expired',
    };
  }

  // Step 4: System paused / maintenance
  if (ctx.systemPaused) {
    return {
      outcome: 'BLOCK',
      rule: 'SYSTEM_PAUSED',
      reason: 'System is paused',
    };
  }
  if (ctx.maintenance) {
    return {
      outcome: 'BLOCK',
      rule: 'SYSTEM_MAINTENANCE',
      reason: 'System is under maintenance cutover',
    };
  }

  const amount = BigInt(proposal.amount_atomic);

  // Step 5: Treasury checks (if S2)
  if (proposal.kind === 'treasury_payout') {
    const to = normalizeAddress(proposal.to);
    if (!to || to === '0x0000000000000000000000000000000000000000') {
      return {
        outcome: 'BLOCK',
        rule: 'INVALID_RECIPIENT',
        reason: 'Zero recipient address is forbidden',
      };
    }
    if (to === normalizeAddress(ctx.mission.agentAddress)) {
      return {
        outcome: 'BLOCK',
        rule: 'CANNOT_PAY_AGENT',
        reason: 'Treasury payout directly to agent is strictly forbidden (no auto-refill)',
      };
    }
    const allowlist = ctx.treasuryAllowlist?.map(normalizeAddress) || [];
    if (!allowlist.includes(to)) {
      return {
        outcome: 'BLOCK',
        rule: 'RECIPIENT_NOT_ALLOWLISTED',
        reason: 'Recipient is not on the treasury allowlist',
      };
    }

    // Soft caps for treasury => QUEUE
    if (amount > 5_000_000n) {
      return { outcome: 'QUEUE', rule: 'OVER_PER_TX_CAP', reason: 'Amount exceeds per-tx treasury cap' };
    }
    return { outcome: 'PASS' };
  }

  // Step 6: Tool catalog and price verification
  const tool = toolCatalog[proposal.tool_id];
  if (!tool) {
    return {
      outcome: 'BLOCK',
      rule: 'UNKNOWN_TOOL',
      reason: `Tool '${proposal.tool_id}' not found in catalog`,
    };
  }
  if (amount !== tool.priceAtomic) {
    return {
      outcome: 'BLOCK',
      rule: 'PRICE_MISMATCH',
      reason: `Proposal price ${amount} does not match catalog price ${tool.priceAtomic}`,
    };
  }

  // Step 7: Tool argument validation and budget limits
  const argValidation = tool.validateInput(proposal.arguments);
  if (!argValidation.valid) {
    return {
      outcome: 'BLOCK',
      rule: 'INVALID_TOOL_ARGUMENTS',
      reason: argValidation.error || 'Invalid arguments for tool',
    };
  }

  if (amount > tool.perCallCap) {
    return {
      outcome: 'BLOCK',
      rule: 'OVER_PER_CALL_CAP',
      reason: 'Amount exceeds per-call limit for tool',
    };
  }

  const availableToolBudget = ctx.mission.toolCap - ctx.mission.spentTool - ctx.mission.reservedTool;
  if (amount > availableToolBudget) {
    return {
      outcome: 'BLOCK',
      rule: 'INSUFFICIENT_TOOL_BUDGET',
      reason: `Required ${amount} exceeds available tool budget ${availableToolBudget}`,
    };
  }

  return {
    outcome: 'PASS',
    canonicalArguments: argValidation.canonicalInput,
  };
}
