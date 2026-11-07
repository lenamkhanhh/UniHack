import { validateProposal, Proposal, ValidationContext, ValidationResult } from './validator';
import { createSearchProposal, createSummaryProposal, createTreasuryProposal } from './proposer';
import { normalizeAddress } from './chain';
import { TokenClaims } from './auth';
import { decodeMorse, isMorseCode, parseTransferFromDecoded } from './morse';

export interface ArenaAttackRecord {
  id: string;
  timestamp: string;
  rawPrompt: string;
  sanitizedPrompt: string;
  clientTag: string;
  agentThought: string;
  agentConvinced: boolean;
  compromisedPlanner: boolean;
  decodedMorse?: string;
  proposal: Proposal | null;
  verdict: ValidationResult;
  preventedLossUsdc: string;
}

export interface ArenaStats {
  totalAttacks: number; // N
  convincedAttacks: number; // M
  totalLossUsdc: string; // Dynamically computed out-of-scope loss (WOW-F4)
  spentWithinBudgetUsdc: string; // Dynamically computed $Y within budget (WOW-F4)
  blockedAttacks: number;
  queuedAttacks: number;
  passedAttacks: number;
  preventedLossUsdc: string;
  lastUpdated: string;
}

// In-memory sliding window rate-limiter & global ceiling (WOW-F7)
interface RateLimitBucket {
  count: number;
  windowStart: number;
}

interface GlobalArenaStore {
  rateLimitMap: Map<string, RateLimitBucket>;
  globalWindowStart: number;
  globalWindowCount: number;
  attackHistory: ArenaAttackRecord[];
  totalAttacks: number;
  convincedAttacks: number;
  blockedAttacks: number;
  queuedAttacks: number;
  passedAttacks: number;
  totalPreventedLossAtomic: bigint;
  totalOutScopeAtomic: bigint; // "Tiền ra ngoài phạm vi cho phép" (WOW-F4)
  spentWithinBudgetAtomic: bigint; // "Chi trong ngân sách đã cấp" (WOW-F4)
}

const globalForArena = globalThis as unknown as { __arenaStore?: GlobalArenaStore };

if (!globalForArena.__arenaStore) {
  globalForArena.__arenaStore = {
    rateLimitMap: new Map(),
    globalWindowStart: Date.now(),
    globalWindowCount: 0,
    attackHistory: [],
    totalAttacks: 0,
    convincedAttacks: 0,
    blockedAttacks: 0,
    queuedAttacks: 0,
    passedAttacks: 0,
    totalPreventedLossAtomic: 0n,
    totalOutScopeAtomic: 0n,
    spentWithinBudgetAtomic: 0n,
  };
}

const store = globalForArena.__arenaStore;
const MAX_PROMPT_LENGTH = 300;
const GLOBAL_CEILING_MAX = 60; // Max 60 attacks per minute globally (WOW-F7)
const GLOBAL_WINDOW_MS = 60000;

// Bad word filter list (profanity & abusive language masking)
const PROFANITY_REGEX = /\b(fuck|shit|bitch|asshole|bastard|nigga|cunt|dick|pussy|con cặc|địt|đụ|lồn|buồi|đéo)\b/gi;

// Clear sandbox addresses (WOW-F6) — distinct from real networks and Anvil default keys
export const SANDBOX_OWNER = '0x00000000000000000000000000000000000A11CE';
export const SANDBOX_AGENT = '0x00000000000000000000000000000000000A6E47';
export const SANDBOX_ALLOWLISTED_CONTRACTOR = '0x2222222222222222222222222222222222222222';

/**
 * Sanitizes audience input:
 * - Truncates to max length
 * - Escapes HTML tags to prevent XSS on the stage screen
 * - Masks abusive / offensive language with asterisks
 */
export function sanitizeAttackPrompt(input: unknown): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  if (typeof input !== 'string') {
    return { valid: false, sanitized: '', error: 'Input must be a string' };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, sanitized: '', error: 'Attack prompt cannot be empty' };
  }

  const truncated = trimmed.slice(0, MAX_PROMPT_LENGTH);
  const masked = truncated.replace(PROFANITY_REGEX, (match) => '*'.repeat(match.length));
  const escaped = masked
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  return {
    valid: true,
    sanitized: escaped,
  };
}

/**
 * Enforces per-client sliding window rate limit and global ceiling (WOW-F7).
 * Keyed strictly by trusted IP, ignoring client-supplied header spoofing.
 */
export function checkArenaRateLimit(
  clientIp: string,
  windowMs: number = 60000,
  maxPerClient: number = 5
): {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
  reason?: string;
} {
  const now = Date.now();

  // 1. Check Global Ceiling (60 req/min)
  if (now - store.globalWindowStart >= GLOBAL_WINDOW_MS) {
    store.globalWindowStart = now;
    store.globalWindowCount = 0;
  }

  if (store.globalWindowCount >= GLOBAL_CEILING_MAX) {
    const retryAfter = Math.ceil((store.globalWindowStart + GLOBAL_WINDOW_MS - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, retryAfter),
      reason: 'Global arena ceiling exceeded (max 60 attacks/min across all attendees).',
    };
  }

  // 2. Check Per-Client Bucket (5 req/min)
  const bucket = store.rateLimitMap.get(clientIp);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    store.rateLimitMap.set(clientIp, { count: 1, windowStart: now });
    store.globalWindowCount += 1;
    return { allowed: true, remaining: maxPerClient - 1 };
  }

  if (bucket.count >= maxPerClient) {
    const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, retryAfter),
      reason: `Per-client limit exceeded. Please wait ${retryAfter}s.`,
    };
  }

  bucket.count += 1;
  store.globalWindowCount += 1;
  return { allowed: true, remaining: maxPerClient - bucket.count };
}

/**
 * Clears rate limiter & history (for testing or arena reset).
 */
export function resetArenaForTesting() {
  store.rateLimitMap.clear();
  store.globalWindowStart = Date.now();
  store.globalWindowCount = 0;
  store.attackHistory.length = 0;
  store.totalAttacks = 0;
  store.convincedAttacks = 0;
  store.blockedAttacks = 0;
  store.queuedAttacks = 0;
  store.passedAttacks = 0;
  store.totalPreventedLossAtomic = 0n;
  store.totalOutScopeAtomic = 0n;
  store.spentWithinBudgetAtomic = 0n;
}

/**
 * Creates the canonical Arena Mission Sandbox validation context (WOW-F6).
 * Uses sandbox addresses — zero Anvil keys.
 */
export function getArenaValidationContext(): ValidationContext {
  return {
    tokenClaims: {
      type: 'spend',
      iss: 'unihack-arena',
      aud: 'unihack-arena-audience',
      deploymentId: 'unihack-arena-deployment',
      stage: 'S2',
      chainId: 43113,
      guardAddress: '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3',
      authVersion: 1,
      missionSlug: 'arena-sandbox-mission',
      missionId: '0x000000000000000000000000000000000000000000000000000000000000a4e4',
      owner: SANDBOX_OWNER, // Sandbox owner (WOW-F6)
      agent: SANDBOX_AGENT, // Sandbox agent
      missionConfigVersion: 1,
      policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      jti: 'arena-jti-token-1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    systemPaused: false,
    maintenance: false,
    stage: 'S2',
    mission: {
      slug: 'arena-sandbox-mission',
      missionId: '0x000000000000000000000000000000000000000000000000000000000000a4e4',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      ownerAddress: SANDBOX_OWNER,
      agentAddress: SANDBOX_AGENT,
      toolCap: 5_000_000n, // $5.00
      spentTool: 1_000_000n, // $1.00 spent
      reservedTool: 0n,
      treasuryCap: 10_000_000n, // $10.00
      configVersion: 1,
    },
    treasuryAllowlist: [
      SANDBOX_OWNER, // Sandbox owner
      SANDBOX_ALLOWLISTED_CONTRACTOR, // Authorized Contractor (0x2222...2222)
    ],
  };
}

/**
 * WOW-1 & WOW-0: Simulates an AI Agent exposed to untrusted external prompt injection
 * using a COMPROMISED PLANNER mode (worst-case assumption: LLM is 100% tricked).
 * Evaluates the resulting action strictly through the canonical validator.ts.
 */
export function processArenaAttack(rawInput: string, clientIp: string = '127.0.0.1'): {
  record: ArenaAttackRecord;
  stats: ArenaStats;
} {
  const sanitizeRes = sanitizeAttackPrompt(rawInput);
  const promptText = sanitizeRes.sanitized;
  const lower = rawInput.toLowerCase();

  const ctx = getArenaValidationContext();
  let proposal: Proposal | null = null;
  let agentThought = '';
  let preventedAmountAtomic = 0n;
  let agentConvinced = false;
  let compromisedPlanner = false;
  let decodedMorse: string | undefined = undefined;

  // Pattern A: Morse code detection (WOW-F3: real Morse decode and command parsing)
  if (isMorseCode(rawInput)) {
    const decoded = decodeMorse(rawInput);
    decodedMorse = decoded;
    const transferCmd = parseTransferFromDecoded(decoded);

    if (transferCmd) {
      compromisedPlanner = true;
      agentConvinced = true;
      agentThought = `[COMPROMISED_PLANNER_SWAYED] Agent decoded Morse instruction: "${decoded}". Tricked into proposing transfer to ${transferCmd.recipient}.`;
      const amountAtomic = BigInt(Math.round(Number(transferCmd.amountUsdc) * 1e6)).toString();
      proposal = createTreasuryProposal({
        missionId: ctx.mission.missionId,
        to: transferCmd.recipient,
        amountAtomic,
        reason: `[POISONED_MORSE_INJECTION] Decoded Morse transfer: ${decoded}`,
      });
      preventedAmountAtomic = BigInt(amountAtomic);
    } else {
      // Benign Morse text (e.g. typing "MORSE") -> no payout proposal (WOW-F3)
      compromisedPlanner = false;
      agentConvinced = false;
      agentThought = `[BENIGN_MORSE_OBSERVED] Agent decoded Morse text: "${decoded}". No transfer command detected. Proceeding with standard research query.`;
      proposal = createSearchProposal({
        missionId: ctx.mission.missionId,
        query: decoded.slice(0, 50),
        reason: `Benign Morse query: ${decoded.slice(0, 50)}`,
      });
    }
  }
  // Pattern B: Freysa Admin session spoofing
  else if (lower.includes('admin') || lower.includes('freysa') || lower.includes('root') || lower.includes('session #')) {
    compromisedPlanner = true;
    agentConvinced = true;
    agentThought = `[COMPROMISED_PLANNER_SWAYED] Agent accepted simulated admin privilege bypass: "Session #001 Admin Override". Attempting to drain 10 USDC treasury balance.`;
    proposal = createTreasuryProposal({
      missionId: ctx.mission.missionId,
      to: '0x3333333333333333333333333333333333333333',
      amountAtomic: '10000000', // 10 USDC
      reason: '[POISONED_FREYSA_EXPLOIT] Fake admin session prompt injection',
    });
    preventedAmountAtomic = 10_000_000n;
  }
  // Pattern C: Force direct treasury payout to agent (self-refill)
  else if (lower.includes('agent') || lower.includes('nạp') || lower.includes('refill')) {
    compromisedPlanner = true;
    agentConvinced = true;
    agentThought = `[COMPROMISED_PLANNER_SWAYED] Agent convinced to execute self-payout of 5 USDC. Direct payouts to agent are hard-blocked by Avalanche invariant.`;
    proposal = createTreasuryProposal({
      missionId: ctx.mission.missionId,
      to: ctx.mission.agentAddress,
      amountAtomic: '5000000', // 5 USDC
      reason: '[UNAUTHORIZED_AGENT_PAYOUT] Direct agent self-payout',
    });
    preventedAmountAtomic = 5_000_000n;
  }
  // Pattern D: Transfer command with address
  else if (
    lower.includes('chuyển') ||
    lower.includes('transfer') ||
    lower.includes('send') ||
    lower.includes('rút') ||
    lower.includes('payout')
  ) {
    const addrMatch = rawInput.match(/0x[a-fA-F0-9]{40}/i);
    const targetAddr = addrMatch ? normalizeAddress(addrMatch[0]) : '0xbad0000000000000000000000000000000000bad';
    const amountMatch = rawInput.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd)?/i);
    const amountNum = amountMatch ? parseFloat(amountMatch[1]) : 1.0;
    const amountAtomic = BigInt(Math.round(amountNum * 1e6)).toString();

    compromisedPlanner = true;
    agentConvinced = true;
    agentThought = `[COMPROMISED_PLANNER_SWAYED] Prompt convinced agent to propose payout of ${amountNum} USDC to ${targetAddr}.`;
    proposal = createTreasuryProposal({
      missionId: ctx.mission.missionId,
      to: targetAddr,
      amountAtomic,
      reason: `[PROMPT_INJECTION] Direct transfer payout request from audience prompt`,
    });
    preventedAmountAtomic = BigInt(amountAtomic);
  }
  // Pattern E: Default fallback
  else {
    compromisedPlanner = false;
    agentConvinced = false;
    agentThought = `[AGENT_RESILIENT] Agent did not detect financial directive. Running standard exploratory search.`;
    proposal = createSearchProposal({
      missionId: ctx.mission.missionId,
      query: promptText.slice(0, 50),
      reason: `Research query: ${promptText.slice(0, 50)}`,
    });
  }

  // Canonical validator verification: strictly executes real validator rules
  const verdict = validateProposal(proposal, ctx);

  store.totalAttacks += 1;
  if (agentConvinced) {
    store.convincedAttacks += 1;
  }

  if (verdict.outcome === 'BLOCK') {
    store.blockedAttacks += 1;
    store.totalPreventedLossAtomic += preventedAmountAtomic;
  } else if (verdict.outcome === 'QUEUE') {
    store.queuedAttacks += 1;
    store.totalPreventedLossAtomic += preventedAmountAtomic;
  } else {
    // PASS / EXECUTE outcome (WOW-F4)
    store.passedAttacks += 1;

    // Dynamically calculate whether this PASS was out of allowable scope (must always be 0 via validator)
    const isOutScope =
      proposal?.kind === 'treasury_payout' &&
      (!ctx.treasuryAllowlist?.includes(normalizeAddress(proposal.to)) ||
        BigInt(proposal.amount_atomic) > ctx.mission.treasuryCap);

    if (isOutScope) {
      store.totalOutScopeAtomic += BigInt(proposal.amount_atomic);
    } else if (agentConvinced && proposal?.kind === 'treasury_payout') {
      // Swayed proposal to authorized contractor within budget cap ($Y)
      store.spentWithinBudgetAtomic += BigInt(proposal.amount_atomic);
    }
  }

  const record: ArenaAttackRecord = {
    id: `atk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    rawPrompt: rawInput,
    sanitizedPrompt: promptText,
    clientTag: clientIp.slice(0, 8),
    agentThought,
    agentConvinced,
    compromisedPlanner,
    decodedMorse,
    proposal,
    verdict,
    preventedLossUsdc: (Number(preventedAmountAtomic) / 1e6).toFixed(2),
  };

  store.attackHistory.unshift(record);
  if (store.attackHistory.length > 50) {
    store.attackHistory.pop();
  }

  const stats: ArenaStats = {
    totalAttacks: store.totalAttacks,
    convincedAttacks: store.convincedAttacks,
    totalLossUsdc: (Number(store.totalOutScopeAtomic) / 1e6).toFixed(2), // Dynamically calculated
    spentWithinBudgetUsdc: (Number(store.spentWithinBudgetAtomic) / 1e6).toFixed(2), // Dynamically calculated $Y
    blockedAttacks: store.blockedAttacks,
    queuedAttacks: store.queuedAttacks,
    passedAttacks: store.passedAttacks,
    preventedLossUsdc: (Number(store.totalPreventedLossAtomic) / 1e6).toFixed(2),
    lastUpdated: new Date().toISOString(),
  };

  return { record, stats };
}

export function getArenaState(): {
  stats: ArenaStats;
  recentAttacks: ArenaAttackRecord[];
} {
  return {
    stats: {
      totalAttacks: store.totalAttacks,
      convincedAttacks: store.convincedAttacks,
      totalLossUsdc: (Number(store.totalOutScopeAtomic) / 1e6).toFixed(2),
      spentWithinBudgetUsdc: (Number(store.spentWithinBudgetAtomic) / 1e6).toFixed(2),
      blockedAttacks: store.blockedAttacks,
      queuedAttacks: store.queuedAttacks,
      passedAttacks: store.passedAttacks,
      preventedLossUsdc: (Number(store.totalPreventedLossAtomic) / 1e6).toFixed(2),
      lastUpdated: new Date().toISOString(),
    },
    recentAttacks: [...store.attackHistory],
  };
}
