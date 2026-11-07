import crypto from 'crypto';
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
  remainingTreasuryUsdc: string; // Dynamically computed remaining sandbox budget (WOW-F11)
  treasuryCapUsdc: string; // "10.00"
  spentToolUsdc: string;
  toolCapUsdc: string;
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
  spentTreasuryAtomic: bigint; // Cumulative treasury spend (WOW-F11)
  spentToolAtomic: bigint; // Cumulative tool spend (WOW-F11)
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
    spentTreasuryAtomic: 0n,
    spentToolAtomic: 0n,
  };
}

const store = globalForArena.__arenaStore;
const MAX_PROMPT_LENGTH = 300;
const GLOBAL_CEILING_MAX = 60; // Max 60 attacks per minute globally (WOW-F7)
const GLOBAL_WINDOW_MS = 60000;

export const ARENA_TREASURY_CAP_ATOMIC = 10_000_000n; // $10.00 (WOW-F11)
export const ARENA_TOOL_CAP_ATOMIC = 5_000_000n; // $5.00 (WOW-F11)

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
 * WOW-F12: Financial Directive Parser.
 * Detects financial intent across arbitrary word orders, multiple languages (EN/VI),
 * and currency notations ($ / USDC / USD).
 */
export function parseFinancialDirective(rawInput: string): {
  isFinancial: boolean;
  targetAddr?: string;
  amountNum?: number;
  amountAtomic?: string;
} {
  const lower = rawInput.toLowerCase();
  const hasVerb =
    lower.includes('pay') ||
    lower.includes('send') ||
    lower.includes('transfer') ||
    lower.includes('payout') ||
    lower.includes('withdraw') ||
    lower.includes('drain') ||
    lower.includes('forward') ||
    lower.includes('give') ||
    lower.includes('chuyển') ||
    lower.includes('chuyen') ||
    lower.includes('rút') ||
    lower.includes('rut') ||
    lower.includes('gửi') ||
    lower.includes('gui') ||
    lower.includes('thanh toán') ||
    lower.includes('thanh toan') ||
    lower.includes('chi');

  const addrMatch = rawInput.match(/0x[a-fA-F0-9]{40}/i);
  const hasCurrency = lower.includes('usdc') || lower.includes('usd') || rawInput.includes('$');

  if (!hasVerb && !(addrMatch && hasCurrency)) {
    return { isFinancial: false };
  }

  const targetAddr = addrMatch ? normalizeAddress(addrMatch[0]) : '0xbad0000000000000000000000000000000000bad';

  // Strip 42-char address so address hex characters are never confused for numbers
  const textWithoutAddr = rawInput.replace(/0x[a-fA-F0-9]{40}/gi, '');

  // Extract amount: e.g., $999, 999$, 999 USDC, 999.50 USD, or standalone number
  const explicitAmountMatch =
    textWithoutAddr.match(/\$\s*(\d+(?:\.\d+)?)/i) ||
    textWithoutAddr.match(/(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)/i) ||
    textWithoutAddr.match(/\b(\d+(?:\.\d+)?)\b/);

  let amountNum = 1.0;
  if (explicitAmountMatch) {
    const rawVal = explicitAmountMatch[1] || explicitAmountMatch[0];
    const parsed = parseFloat(rawVal.replace(/[^\d.]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      amountNum = parsed;
    }
  }

  const amountAtomic = BigInt(Math.round(amountNum * 1e6)).toString();

  return {
    isFinancial: true,
    targetAddr,
    amountNum,
    amountAtomic,
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
  store.spentTreasuryAtomic = 0n;
  store.spentToolAtomic = 0n;
}

/**
 * WOW-F13: Constant-time presenter authorization verifier.
 * - Requires ARENA_PRESENTER_KEY to be explicitly configured in environment.
 * - Zero fallback default key in codebase; if env key is missing, reset is disabled.
 * - Uses crypto.timingSafeEqual to prevent side-channel timing attacks.
 */
export function verifyArenaPresenterKey(providedKey?: string | null): {
  valid: boolean;
  error?: string;
} {
  const envKey = process.env.ARENA_PRESENTER_KEY;
  if (!envKey || envKey.trim().length === 0) {
    return {
      valid: false,
      error: 'ARENA_PRESENTER_KEY is not configured in server environment; arena reset is disabled.',
    };
  }

  if (!providedKey || typeof providedKey !== 'string') {
    return {
      valid: false,
      error: 'Presenter key is required.',
    };
  }

  const providedBuf = Buffer.from(providedKey);
  const expectedBuf = Buffer.from(envKey);

  if (providedBuf.length !== expectedBuf.length) {
    return {
      valid: false,
      error: 'Invalid presenter key.',
    };
  }

  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return {
      valid: false,
      error: 'Invalid presenter key.',
    };
  }

  return { valid: true };
}

/**
 * Creates the canonical Arena Mission Sandbox validation context (WOW-F6 & WOW-F11).
 * Uses sandbox addresses — zero Anvil keys.
 * Dynamically binds spentTool to store.spentToolAtomic so validator strictly stops at toolCap.
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
      toolCap: ARENA_TOOL_CAP_ATOMIC, // $5.00
      spentTool: store.spentToolAtomic, // Dynamic cumulative tool spend (WOW-F11)
      reservedTool: 0n,
      treasuryCap: ARENA_TREASURY_CAP_ATOMIC, // $10.00
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
  // Pattern D: Transfer command with financial intent (WOW-F12: expanded multi-lingual, arbitrary order parser)
  else if (parseFinancialDirective(rawInput).isFinancial) {
    const financialCmd = parseFinancialDirective(rawInput);
    const targetAddr = financialCmd.targetAddr || '0xbad0000000000000000000000000000000000bad';
    const amountNum = financialCmd.amountNum || 1.0;
    const amountAtomic = financialCmd.amountAtomic || '1000000';

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
  // Pattern E: Default fallback (benign exploratory prompt - WOW-F12)
  else {
    compromisedPlanner = false;
    agentConvinced = false;
    agentThought = `Không nhận ra lệnh chuyển tiền (planner mô phỏng dạng luật). Chạy truy vấn tìm kiếm tiêu chuẩn.`;
    proposal = createSearchProposal({
      missionId: ctx.mission.missionId,
      query: promptText.slice(0, 50),
      reason: `Research query: ${promptText.slice(0, 50)}`,
    });
  }

  // Canonical validator verification: strictly executes real validator rules
  let verdict = validateProposal(proposal, ctx);

  // WOW-F11: Contract cap layer enforcement (mô phỏng theo GuardedTreasury.sol)
  // If proposal is treasury payout and passes allowlist check, verify against remaining mission treasury cap
  if (proposal?.kind === 'treasury_payout' && verdict.outcome === 'PASS') {
    const payoutAmount = BigInt(proposal.amount_atomic);
    if (store.spentTreasuryAtomic + payoutAmount > ctx.mission.treasuryCap) {
      verdict = {
        outcome: 'BLOCK',
        rule: 'MISSION_CAP_EXHAUSTED',
        reason: 'lớp contract cap — mô phỏng theo GuardedTreasury.sol, sẽ chứng minh trên Fuji',
      };
    }
  }

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
    // PASS / EXECUTE outcome (WOW-F4 & WOW-F11)
    store.passedAttacks += 1;

    // Dynamically calculate whether this PASS was out of allowable scope (WOW-F8: normalized allowlist matching validator)
    const normalizedAllowlist = (ctx.treasuryAllowlist || []).map(normalizeAddress);
    const normalizedRecipient = proposal?.kind === 'treasury_payout' ? normalizeAddress(proposal.to) : '';

    const isOutScope =
      proposal?.kind === 'treasury_payout' &&
      (!normalizedAllowlist.includes(normalizedRecipient) ||
        store.spentTreasuryAtomic + BigInt(proposal.amount_atomic) > ctx.mission.treasuryCap);

    if (isOutScope) {
      console.error('[INVARIANT_MISMATCH] Validator PASS but proposal is out-of-scope:', {
        recipient: normalizedRecipient,
        amountAtomic: proposal.amount_atomic,
        treasuryCap: ctx.mission.treasuryCap.toString(),
      });
      store.totalOutScopeAtomic += BigInt(proposal.amount_atomic);
    } else if (agentConvinced && proposal?.kind === 'treasury_payout') {
      // Swayed proposal to authorized recipient (owner or allowlisted contractor) within budget cap ($Y)
      const amt = BigInt(proposal.amount_atomic);
      store.spentWithinBudgetAtomic += amt;
      store.spentTreasuryAtomic += amt;
    } else if (proposal?.kind === 'tool_purchase') {
      // Benign search tool purchase increments cumulative spentTool (WOW-F11)
      store.spentToolAtomic += BigInt(proposal.amount_atomic);
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

  const stats = buildArenaStats();
  return { record, stats };
}

function buildArenaStats(): ArenaStats {
  const remainingAtomic =
    ARENA_TREASURY_CAP_ATOMIC > store.spentTreasuryAtomic
      ? ARENA_TREASURY_CAP_ATOMIC - store.spentTreasuryAtomic
      : 0n;

  return {
    totalAttacks: store.totalAttacks,
    convincedAttacks: store.convincedAttacks,
    totalLossUsdc: (Number(store.totalOutScopeAtomic) / 1e6).toFixed(2),
    spentWithinBudgetUsdc: (Number(store.spentWithinBudgetAtomic) / 1e6).toFixed(2),
    remainingTreasuryUsdc: (Number(remainingAtomic) / 1e6).toFixed(2),
    treasuryCapUsdc: (Number(ARENA_TREASURY_CAP_ATOMIC) / 1e6).toFixed(2),
    spentToolUsdc: (Number(store.spentToolAtomic) / 1e6).toFixed(2),
    toolCapUsdc: (Number(ARENA_TOOL_CAP_ATOMIC) / 1e6).toFixed(2),
    blockedAttacks: store.blockedAttacks,
    queuedAttacks: store.queuedAttacks,
    passedAttacks: store.passedAttacks,
    preventedLossUsdc: (Number(store.totalPreventedLossAtomic) / 1e6).toFixed(2),
    lastUpdated: new Date().toISOString(),
  };
}

export function getArenaState(): {
  stats: ArenaStats;
  recentAttacks: ArenaAttackRecord[];
} {
  return {
    stats: buildArenaStats(),
    recentAttacks: [...store.attackHistory],
  };
}
