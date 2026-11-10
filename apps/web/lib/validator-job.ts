import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  Hex,
  PublicClient,
  WalletClient,
  getAddress,
  encodeFunctionData,
  decodeEventLog,
  encodeEventTopics,
  parseAbiItem,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { prisma } from './db';
import { computePayeeMerkleTree } from './merkle';
import {
  ValidationBundle,
  ValidationCheckResult,
  computeValidationRequestHash,
  validateBundleOnChain,
} from './validation-bundle';
import { getGuardedTreasuryAddress, getPaymentMode, getPasskeyAuthorityAddress } from './config';

/**
 * Serializes objects containing BigInt properties safely to JSON.
 */
export function serializeWithBigInt(obj: any, space?: number): string {
  return JSON.stringify(
    obj,
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    space
  );
}

export const VALIDATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'validationRequest',
    inputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'requestURI', type: 'string' },
      { name: 'requestHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'validationResponse',
    inputs: [
      { name: 'requestHash', type: 'bytes32' },
      { name: 'response', type: 'uint8' },
      { name: 'responseURI', type: 'string' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isValidationComplete',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getValidationStatus',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'response', type: 'uint8' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag', type: 'string' },
      { name: 'lastUpdate', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

export const DEFAULT_VALIDATION_REGISTRY: `0x${string}` =
  '0x4c5ccda2a630cd1cb706799deadcc8483d06697e';
export const DEFAULT_ERC8004_AGENT_ID = 294n;

export function getValidationRegistryAddress(): `0x${string}` {
  const configured =
    process.env.VALIDATION_REGISTRY_ADDRESS ||
    process.env.NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS;
  if (configured && configured.startsWith('0x') && configured.length === 42) {
    return getAddress(configured) as `0x${string}`;
  }
  return DEFAULT_VALIDATION_REGISTRY;
}

export function getValidatorPrivateKey(): Hex | null {
  const key = process.env.VALIDATOR_PRIVATE_KEY;
  if (key && key.startsWith('0x') && key.length === 66) {
    return key as Hex;
  }
  return null;
}

export function getErc8004AgentId(): bigint {
  const envVal =
    process.env.ERC8004_AGENT_ID ||
    process.env.NEXT_PUBLIC_ERC8004_AGENT_ID;
  if (envVal) {
    try {
      return BigInt(envVal);
    } catch {}
  }
  return DEFAULT_ERC8004_AGENT_ID;
}

export const VALIDATION_REQUEST_EVENT_ABI = parseAbiItem(
  'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)'
);

export const VALIDATION_RESPONSE_EVENT_ABI = parseAbiItem(
  'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, bytes32 responseHash, string tag)'
);

export const MISSION_CREATED_EVENT_ABI = parseAbiItem(
  'event MissionCreated(bytes32 indexed missionId, address indexed agent, uint256 cap, uint256 expiresAt)'
);

export function getValidatorAddress(): string {
  const key = getValidatorPrivateKey();
  if (key) {
    try {
      return privateKeyToAccount(key).address;
    } catch {}
  }
  return process.env.VALIDATOR_ADDRESS || '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5';
}

export type ValidationJobStatus =
  | 'QUEUED'
  | 'LOCAL_EVALUATING'
  | 'LOCAL_EVALUATED'
  | 'REQUEST_PENDING'
  | 'RESPONSE_PENDING'
  | 'RESPONSE_CONFIRMED'
  | 'STALE_CONTEXT'
  | 'FAILED';

export interface UnsignedValidationRequest {
  to: `0x${string}`;
  data: Hex;
  value: string;
  chainId: number;
  functionName: 'validationRequest';
  validatorAddress: string;
  agentId: string;
  requestURI: string;
  requestHash: `0x${string}`;
  ownerAddress?: string;
  missionSlug: string;
}

export function buildUnsignedValidationRequest(params: {
  registryAddress: `0x${string}`;
  validatorAddress: string;
  agentId: bigint;
  slug: string;
  requestHash: `0x${string}`;
  ownerAddress?: string;
  chainId?: number;
}): UnsignedValidationRequest {
  const requestURI = `evidence/validation/${params.slug}.json`;
  const data = encodeFunctionData({
    abi: VALIDATION_REGISTRY_ABI,
    functionName: 'validationRequest',
    args: [
      params.validatorAddress as `0x${string}`,
      params.agentId,
      requestURI,
      params.requestHash,
    ],
  });

  return {
    to: params.registryAddress,
    data,
    value: '0x0',
    chainId: params.chainId ?? 43113,
    functionName: 'validationRequest',
    validatorAddress: params.validatorAddress,
    agentId: params.agentId.toString(),
    requestURI,
    requestHash: params.requestHash,
    ownerAddress: params.ownerAddress,
    missionSlug: params.slug,
  };
}

/**
 * Reconciles and cryptographically verifies an on-chain mission creation receipt.
 * Permits direct call to GuardedTreasury OR routed call via PasskeyMissionAuthority.
 * Validates chain ID, non-empty blockNumber, and exact MissionCreated event emitter and missionId.
 */
export async function verifyMissionCreationReceipt(params: {
  receiptTxHash: string;
  expectedMissionId: string;
  expectedTreasury?: string;
  expectedAuthority?: string;
  expectedChainId?: number;
  publicClient?: PublicClient;
  rpcUrl?: string;
}): Promise<{
  valid: boolean;
  creationBlock?: bigint;
  txHash?: string;
  provenance?: string;
  error?: string;
}> {
  const treasury = (params.expectedTreasury || getGuardedTreasuryAddress()).toLowerCase();
  const authority = (
    params.expectedAuthority ||
    getPasskeyAuthorityAddress()
  ).toLowerCase();
  const expectedChainId = params.expectedChainId ?? 43113;

  const rpcUrl =
    params.rpcUrl ||
    process.env.AVALANCHE_FUJI_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    'https://api.avax-test.network/ext/bc/C/rpc';

  const client =
    params.publicClient ||
    createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

  // Verify chain ID if client supports it
  if (typeof client.getChainId === 'function') {
    try {
      const chainId = await client.getChainId();
      if (chainId !== expectedChainId) {
        return {
          valid: false,
          error: `Chain ID mismatch: expected ${expectedChainId}, got ${chainId}`,
        };
      }
    } catch (err: any) {
      return {
        valid: false,
        error: `Failed to verify chain ID: ${err?.message || 'RPC error'}`,
      };
    }
  }

  const receipt = await client.getTransactionReceipt({
    hash: params.receiptTxHash as Hex,
  }).catch(() => null);

  if (!receipt) {
    return { valid: false, error: 'Transaction receipt not found on chain' };
  }

  if (receipt.status !== 'success') {
    return { valid: false, error: 'Creation transaction reverted on chain' };
  }

  if (!receipt.to) {
    return { valid: false, error: 'Receipt recipient is missing' };
  }

  const receiptTo = receipt.to.toLowerCase();
  const isDirectTreasury = receiptTo === treasury;
  const isAuthorityRouter = receiptTo === authority;

  if (!isDirectTreasury && !isAuthorityRouter) {
    return {
      valid: false,
      error: `Recipient mismatch: expected treasury (${treasury}) or authority (${authority}), got ${receipt.to}`,
    };
  }

  if (!receipt.blockNumber || receipt.blockNumber <= 0n) {
    return { valid: false, error: 'Receipt missing valid blockNumber metadata' };
  }

  const expectedMissionIdFormatted = (
    params.expectedMissionId.startsWith('0x')
      ? params.expectedMissionId
      : `0x${params.expectedMissionId}`
  ).toLowerCase();

  const expectedTopic0 = encodeEventTopics({
    abi: [MISSION_CREATED_EVENT_ABI],
    eventName: 'MissionCreated',
  })[0]?.toLowerCase();

  let eventFound = false;
  for (const log of receipt.logs || []) {
    // Emitter MUST strictly be GuardedTreasury contract
    if (!log.address || log.address.toLowerCase() !== treasury) {
      continue;
    }
    if (log.topics && log.topics[0]?.toLowerCase() === expectedTopic0) {
      if (log.topics[1]?.toLowerCase() === expectedMissionIdFormatted) {
        eventFound = true;
        break;
      }
    }
    try {
      const decoded = decodeEventLog({
        abi: [MISSION_CREATED_EVENT_ABI],
        data: log.data,
        topics: log.topics,
      }) as any;

      if (decoded.eventName === 'MissionCreated') {
        const evMissionId = (decoded.args.missionId as string)?.toLowerCase();
        if (evMissionId === expectedMissionIdFormatted) {
          eventFound = true;
          break;
        }
      }
    } catch {}
  }

  if (!eventFound) {
    return {
      valid: false,
      error: 'MissionCreated event not found or missionId mismatch from treasury in receipt logs',
    };
  }

  const blockNumber =
    typeof receipt.blockNumber === 'bigint'
      ? receipt.blockNumber
      : BigInt(receipt.blockNumber);
  const provenance = isDirectTreasury
    ? 'DIRECT_TREASURY_RECEIPT'
    : 'AUTHORITY_ROUTED_RECEIPT';

  return {
    valid: true,
    creationBlock: blockNumber,
    txHash: params.receiptTxHash,
    provenance,
  };
}

/**
 * Reconciles creation receipt for an existing mission in DB.
 */
export async function reconcileMissionCreationReceipt(
  slug: string,
  txHash: string,
  options: {
    publicClient?: PublicClient;
    rpcUrl?: string;
    expectedTreasury?: string;
    expectedAuthority?: string;
  } = {}
): Promise<{
  success: boolean;
  creationBlock?: string;
  creationTxHash?: string;
  provenance?: string;
  error?: string;
}> {
  const mission = await prisma.mission.findUnique({
    where: { slug },
  });

  if (!mission) {
    return { success: false, error: `Mission not found for slug: ${slug}` };
  }

  const verification = await verifyMissionCreationReceipt({
    receiptTxHash: txHash,
    expectedMissionId: mission.missionId,
    expectedTreasury: options.expectedTreasury,
    expectedAuthority: options.expectedAuthority,
    publicClient: options.publicClient,
    rpcUrl: options.rpcUrl,
  });

  if (!verification.valid || !verification.creationBlock) {
    return {
      success: false,
      error: verification.error || 'Failed to verify creation receipt',
    };
  }

  await prisma.mission.update({
    where: { slug },
    data: {
      creationBlock: verification.creationBlock,
      creationTxHash: txHash,
      creationProvenance: verification.provenance,
    },
  });

  // If a ValidationJob exists for this mission, update its fromBlock and frozenContext
  const existingJob = await prisma.validationJob.findUnique({
    where: { missionSlug: slug },
  });
  if (existingJob && (!existingJob.fromBlock || existingJob.status === 'QUEUED')) {
    let updatedFrozen = existingJob.frozenContext;
    if (existingJob.frozenContext) {
      try {
        const parsed = JSON.parse(existingJob.frozenContext);
        parsed.creationBlock = verification.creationBlock.toString();
        updatedFrozen = serializeWithBigInt(parsed);
      } catch {}
    }
    await prisma.validationJob.update({
      where: { missionSlug: slug },
      data: {
        fromBlock: verification.creationBlock,
        frozenContext: updatedFrozen,
      },
    });
  }

  return {
    success: true,
    creationBlock: verification.creationBlock.toString(),
    creationTxHash: txHash,
    provenance: verification.provenance,
  };
}

export interface InMemoryValidationRecord {
  requestHash: string;
  validatorAddress?: string;
  agentId?: string;
  score?: number;
  responseHash?: string;
  tag?: string;
  lastUpdate?: number;
  isComplete?: boolean;
  status: string;
  txHash?: string;
  bundle?: ValidationBundle;
  details?: any;
  unsignedRequest?: any;
  failureReason?: string;
  isRegisteredOnChain?: boolean;
  requestTxHash?: string | null;
  responseTxHash?: string | null;
}

const memoryValidationCache = new Map<string, InMemoryValidationRecord>();

export function getMemoryValidationRecord(requestHash: string): InMemoryValidationRecord | undefined {
  return memoryValidationCache.get(requestHash.toLowerCase());
}

export function setMemoryValidationRecord(record: InMemoryValidationRecord): void {
  memoryValidationCache.set(record.requestHash.toLowerCase(), record);
}

export function clearMemoryValidationCache(): void {
  memoryValidationCache.clear();
}

/**
 * Authoritative DB lookup. Does NOT swallow DB failures into null.
 */
export async function getValidationJobFromDb(slug: string) {
  return await prisma.validationJob.findUnique({
    where: { missionSlug: slug },
  });
}

/**
 * Authoritative DB lookup by requestHash. Does NOT swallow DB failures into null.
 */
export async function getValidationJobByRequestHash(requestHash: string) {
  return await prisma.validationJob.findUnique({
    where: { requestHash },
  });
}

export type ValidationFetcher = (missionId: string, requestHash: string) => Promise<any | null>;
let validationFetcherForTesting: ValidationFetcher | null = null;

export function setValidationFetcherForTesting(fetcher: ValidationFetcher | null) {
  validationFetcherForTesting = fetcher;
}

export function getValidationFetcherForTesting(): ValidationFetcher | null {
  return validationFetcherForTesting;
}

/**
 * Builds cryptographic ValidationBundle for a mission directly from DB & config.
 */
export async function buildMissionValidationBundle(
  slug: string,
  overrides: {
    tamperAuditHead?: `0x${string}`;
    tamperPayeeRoot?: `0x${string}`;
    anchorTxHash?: `0x${string}`;
  } = {}
): Promise<ValidationBundle> {
  const mission = await prisma.mission.findUnique({
    where: { slug },
  });

  if (!mission) {
    throw new Error(`Mission not found for slug: ${slug}`);
  }

  let payees: string[] = [];
  if (mission.payeesJson) {
    try {
      payees = JSON.parse(mission.payeesJson);
    } catch {
      payees = [];
    }
  }

  let payeeRoot: `0x${string}`;
  if (mission.payeeRoot && mission.payeeRoot.startsWith('0x')) {
    payeeRoot = mission.payeeRoot as `0x${string}`;
  } else {
    const tree = computePayeeMerkleTree(payees);
    payeeRoot = tree.root as `0x${string}`;
  }

  let latestEntry: any = null;
  try {
    latestEntry = await prisma.auditEntry.findFirst({
      where: { missionSlug: slug },
      orderBy: { missionSequence: 'desc' },
    });
  } catch {}

  const auditHead = (overrides.tamperAuditHead ||
    latestEntry?.entryHash ||
    mission.auditHeadHash ||
    '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`;

  const treasury = getGuardedTreasuryAddress();

  const rawMissionId = mission.missionId.startsWith('0x')
    ? mission.missionId
    : `0x${mission.missionId}`;
  const missionId = rawMissionId.padEnd(66, '0') as `0x${string}`;

  const anchorTxHash = (overrides.anchorTxHash ||
    mission.deliverableHash ||
    '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`;

  const bundle: ValidationBundle = {
    version: 'MissionPay-validation-v1',
    missionId,
    missionSlug: mission.slug,
    payeeRoot: (overrides.tamperPayeeRoot || payeeRoot) as `0x${string}`,
    auditHead,
    anchorTxHash,
    chainId: 43113,
    treasury,
    payees,
    cap: mission.treasuryCap?.toString(),
    ownerAddress: mission.ownerAddress,
    creationBlock: mission.creationBlock ?? undefined,
  };

  return bundle;
}

export interface RunValidatorJobOptions {
  publicClient?: PublicClient;
  ownerWalletClient?: WalletClient;
  validatorWalletClient?: WalletClient;
  validatorAccount?: any;
  rpcUrl?: string;
  tamperAuditHead?: `0x${string}`;
  tamperPayeeRoot?: `0x${string}`;
  fromBlock?: bigint;
  toBlock?: bigint;
  skipOnChainBroadcast?: boolean;
}

export interface AdvanceJobOptions extends RunValidatorJobOptions {
  leaseToken?: string;
  workerId?: string;
  leaseDurationMs?: number;
}

export interface ValidatorJobResult {
  bundle: ValidationBundle;
  requestHash: `0x${string}`;
  validationResult: ValidationCheckResult;
  status: ValidationJobStatus;
  isRegisteredOnChain: boolean;
  requestTxHash?: string;
  responseTxHash?: string;
  unsignedRequest?: any;
  failureReason?: string;
  chainScore?: number;
  chainTag?: string;
  responseHash?: string;
}

/**
 * Claims a specific validation job atomically with lease semantics.
 * Processable nonterminal stages: QUEUED, LOCAL_EVALUATING, LOCAL_EVALUATED, REQUEST_PENDING, RESPONSE_PENDING.
 */
export async function claimValidationJob(
  slug: string,
  workerId: string = 'worker-default',
  leaseDurationMs: number = 60_000
): Promise<any | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseDurationMs);
  const leaseToken = randomUUID();

  const candidate = await prisma.validationJob.findUnique({
    where: { missionSlug: slug },
  });

  if (!candidate) return null;

  if (candidate.workerLeaseUntil && candidate.workerLeaseUntil >= now) {
    return null; // Active lease held by someone else
  }

  const nextStatus = candidate.status === 'QUEUED' ? 'LOCAL_EVALUATING' : candidate.status;

  const updated = await prisma.validationJob.updateMany({
    where: {
      missionSlug: slug,
      status: { in: ['QUEUED', 'LOCAL_EVALUATING', 'LOCAL_EVALUATED', 'REQUEST_PENDING', 'RESPONSE_PENDING'] },
      OR: [
        { workerLeaseUntil: null },
        { workerLeaseUntil: { lt: now } },
      ],
    },
    data: {
      status: nextStatus,
      workerLeaseUntil: leaseUntil,
      workerLeaseOwner: workerId,
      leaseToken,
      retryCount: { increment: 1 },
    },
  });

  if (updated.count === 0) {
    return null;
  }

  const job = await prisma.validationJob.findUnique({
    where: { missionSlug: slug },
    include: { mission: true },
  });

  if (!job) return null;
  return Object.assign(job, { job, leaseToken });
}

/**
 * Claims the next queued or expired-lease validation job atomically with lease semantics.
 */
export async function claimNextValidationJob(
  workerId: string = 'worker-default',
  leaseDurationMs: number = 60_000,
  excludeSlugs: string[] = []
): Promise<any | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseDurationMs);
  const leaseToken = randomUUID();

  return await prisma.$transaction(async (tx) => {
    const candidate = await tx.validationJob.findFirst({
      where: {
        status: { in: ['QUEUED', 'LOCAL_EVALUATING', 'LOCAL_EVALUATED', 'REQUEST_PENDING', 'RESPONSE_PENDING'] },
        ...(excludeSlugs.length > 0 ? { missionSlug: { notIn: excludeSlugs } } : {}),
        OR: [
          { workerLeaseUntil: null },
          { workerLeaseUntil: { lt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!candidate) return null;

    const nextStatus = candidate.status === 'QUEUED' ? 'LOCAL_EVALUATING' : candidate.status;

    const updated = await tx.validationJob.updateMany({
      where: {
        id: candidate.id,
        workerLeaseUntil: candidate.workerLeaseUntil,
      },
      data: {
        status: nextStatus,
        workerLeaseUntil: leaseUntil,
        workerLeaseOwner: workerId,
        leaseToken,
        retryCount: { increment: 1 },
      },
    });

    if (updated.count === 0) return null;

    const job = await tx.validationJob.findUnique({
      where: { id: candidate.id },
      include: { mission: true },
    });

    if (!job) return null;
    return Object.assign(job, { job, leaseToken });
  });
}

/**
 * Fenced update helper: ensures worker still holds the lease.
 */
async function updateJobWithLease(
  slug: string,
  leaseToken: string,
  data: any
) {
  const res = await prisma.validationJob.updateMany({
    where: {
      missionSlug: slug,
      leaseToken,
    },
    data,
  });
  if (res.count === 0) {
    throw new Error(`Lease fencing error: lease ${leaseToken} on ${slug} was lost or expired`);
  }
}

/**
 * Releases worker lease on a job.
 */
async function releaseJobLease(slug: string, leaseToken?: string) {
  try {
    await prisma.validationJob.updateMany({
      where: {
        missionSlug: slug,
        ...(leaseToken ? { leaseToken } : {}),
      },
      data: {
        workerLeaseUntil: null,
        workerLeaseOwner: null,
        leaseToken: null,
      },
    });
  } catch {}
}

/**
 * Unified Post-Mission Validation State Machine Runner.
 * Processes the job through nonterminal stages with lease fencing and context preservation.
 */
export async function advanceValidationJob(
  slug: string,
  options: AdvanceJobOptions = {}
): Promise<ValidatorJobResult> {
  const mission = await prisma.mission.findUnique({
    where: { slug },
  });

  if (!mission) {
    throw new Error(`Mission not found for slug: ${slug}`);
  }

  // 1. Acquire or verify lease
  let leaseToken: string = options.leaseToken || '';
  let job: any = null;

  if (leaseToken) {
    job = await prisma.validationJob.findUnique({
      where: { missionSlug: slug },
      include: { mission: true },
    });
    if (!job || job.leaseToken !== leaseToken) {
      throw new Error(`Invalid or expired lease token: ${leaseToken}`);
    }
  } else {
    const claim = await claimValidationJob(
      slug,
      options.workerId || 'worker-default',
      options.leaseDurationMs || 60_000
    );
    if (!claim) {
      const existing = await prisma.validationJob.findUnique({
        where: { missionSlug: slug },
        include: { mission: true },
      });
      if (existing) {
        if (existing.status === 'RESPONSE_CONFIRMED' || existing.status === 'FAILED') {
          let evalParsed: any = null;
          try {
            evalParsed = existing.evaluationResult ? JSON.parse(existing.evaluationResult) : null;
          } catch {}
          return {
            bundle: existing.frozenContext ? JSON.parse(existing.frozenContext) : null,
            requestHash: existing.requestHash as Hex,
            validationResult: evalParsed,
            status: existing.status as ValidationJobStatus,
            isRegisteredOnChain: existing.status === 'RESPONSE_CONFIRMED',
            requestTxHash: existing.requestTxHash || undefined,
            responseTxHash: existing.responseTxHash || undefined,
            failureReason: existing.failureReason || undefined,
            chainScore: existing.chainScore ?? undefined,
            chainTag: existing.chainTag ?? undefined,
            responseHash: existing.responseHash ?? undefined,
          };
        }
        if (existing.workerLeaseUntil && existing.workerLeaseUntil >= new Date()) {
          throw new Error(`ValidationJob is currently locked by another worker process: ${existing.workerLeaseOwner}`);
        }
      }

      // No job exists yet: create initial queued job with lease
      const initialBundle = await buildMissionValidationBundle(slug, {
        tamperAuditHead: options.tamperAuditHead,
        tamperPayeeRoot: options.tamperPayeeRoot,
      });
      const reqHash = computeValidationRequestHash(initialBundle);
      const newLeaseToken = randomUUID();
      const leaseUntil = new Date(Date.now() + (options.leaseDurationMs || 60_000));
      job = await prisma.validationJob.create({
        data: {
          missionSlug: slug,
          missionId: mission.missionId,
          requestHash: reqHash,
          status: 'LOCAL_EVALUATING',
          frozenContext: serializeWithBigInt(initialBundle),
          workerLeaseOwner: options.workerId || 'worker-default',
          workerLeaseUntil: leaseUntil,
          leaseToken: newLeaseToken,
          fromBlock: initialBundle.creationBlock,
        },
        include: { mission: true },
      });
      leaseToken = newLeaseToken;
    } else {
      job = claim.job || claim;
      leaseToken = claim.leaseToken || '';
    }
  }

  if (!leaseToken) {
    throw new Error('Failed to acquire valid lease token');
  }

  const registryAddress = getValidationRegistryAddress();
  const agentId = getErc8004AgentId();
  const rpcUrl =
    options.rpcUrl ||
    process.env.AVALANCHE_FUJI_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    'https://api.avax-test.network/ext/bc/C/rpc';

  const publicClient =
    options.publicClient ||
    createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

  try {
    // 2. Frozen Context Resolution & Integrity Check
    let bundle: ValidationBundle;
    if (job.frozenContext) {
      try {
        bundle = JSON.parse(job.frozenContext);
      } catch (err: any) {
        throw new Error(`MALFORMED_FROZEN_CONTEXT: could not parse persisted frozen context: ${err?.message || err}`);
      }

      // Check for stale context mutation: if mission state was mutated after job was frozen
      if (mission.auditHeadHash && bundle.auditHead && mission.auditHeadHash !== bundle.auditHead) {
        await updateJobWithLease(slug, leaseToken, {
          status: 'STALE_CONTEXT',
          failureReason: 'STALE_CONTEXT: mission auditHeadHash mutated after validation job was frozen',
        });
        await releaseJobLease(slug, leaseToken);
        return {
          bundle,
          requestHash: job.requestHash as Hex,
          validationResult: { valid: false, score: 0, checks: {} as any, tag: 'STALE_CONTEXT', details: {} as any },
          status: 'STALE_CONTEXT',
          isRegisteredOnChain: false,
          failureReason: 'STALE_CONTEXT: mission auditHeadHash mutated after validation job was frozen',
        };
      }

      if (mission.payeeRoot && bundle.payeeRoot && mission.payeeRoot !== bundle.payeeRoot) {
        await updateJobWithLease(slug, leaseToken, {
          status: 'STALE_CONTEXT',
          failureReason: 'STALE_CONTEXT: mission payeeRoot mutated after validation job was frozen',
        });
        await releaseJobLease(slug, leaseToken);
        return {
          bundle,
          requestHash: job.requestHash as Hex,
          validationResult: { valid: false, score: 0, checks: {} as any, tag: 'STALE_CONTEXT', details: {} as any },
          status: 'STALE_CONTEXT',
          isRegisteredOnChain: false,
          failureReason: 'STALE_CONTEXT: mission payeeRoot mutated after validation job was frozen',
        };
      }
    } else {
      bundle = await buildMissionValidationBundle(slug, {
        tamperAuditHead: options.tamperAuditHead,
        tamperPayeeRoot: options.tamperPayeeRoot,
      });
      await updateJobWithLease(slug, leaseToken, {
        frozenContext: serializeWithBigInt(bundle),
      });
    }

    const requestHash = computeValidationRequestHash(bundle);

    // 3. Local Evaluation Step (if QUEUED, LOCAL_EVALUATING, evaluationResult is missing, or explicit client provided)
    let validationResult: ValidationCheckResult;
    const shouldEvaluate =
      job.status === 'QUEUED' ||
      job.status === 'LOCAL_EVALUATING' ||
      !job.evaluationResult ||
      Boolean(options.publicClient && job.status !== 'RESPONSE_CONFIRMED');

    if (shouldEvaluate) {
      try {
        validationResult = await validateBundleOnChain(
          publicClient,
          bundle,
          options.fromBlock ?? (job.fromBlock ? BigInt(job.fromBlock) : undefined),
          options.toBlock ?? (job.toBlock ? BigInt(job.toBlock) : undefined)
        );
      } catch (err: any) {
        await updateJobWithLease(slug, leaseToken, {
          status: 'FAILED',
          failureReason: `Evaluation error: ${err.message?.slice(0, 50)}`,
        });
        await releaseJobLease(slug, leaseToken);
        return {
          bundle,
          requestHash,
          validationResult: { valid: false, score: 0, checks: {} as any, tag: 'EVALUATION_ERROR', details: {} as any },
          status: 'FAILED',
          isRegisteredOnChain: false,
          failureReason: `Evaluation error: ${err.message?.slice(0, 50)}`,
        };
      }

      const snapshotBlockBigInt = validationResult.snapshotBlock ? BigInt(validationResult.snapshotBlock) : null;
      const fromBlockBigInt = options.fromBlock ?? (validationResult.fromBlock ? BigInt(validationResult.fromBlock) : (bundle.creationBlock ?? null));
      const toBlockBigInt = options.toBlock ?? (validationResult.toBlock ? BigInt(validationResult.toBlock) : (snapshotBlockBigInt ?? null));

      await updateJobWithLease(slug, leaseToken, {
        status: 'LOCAL_EVALUATED',
        evaluationResult: serializeWithBigInt(validationResult),
        score: validationResult.score,
        tag: validationResult.tag,
        snapshotBlock: snapshotBlockBigInt,
        fromBlock: fromBlockBigInt,
        toBlock: toBlockBigInt,
        failureReason: null,
      });
      job.status = 'LOCAL_EVALUATED';
      job.evaluationResult = serializeWithBigInt(validationResult);
      job.score = validationResult.score;
      job.tag = validationResult.tag;
    } else {
      validationResult = JSON.parse(job.evaluationResult);
    }

    // Prepare evidence payload
    const responseData = {
      requestHash,
      missionId: bundle.missionId,
      missionSlug: bundle.missionSlug,
      evaluatedAt: new Date().toISOString(),
      agentId: agentId.toString(),
      score: validationResult.score,
      tag: validationResult.tag,
      checks: validationResult.checks,
      details: validationResult.details,
    };
    const responseJsonString = serializeWithBigInt(responseData, 2);
    const responseHash = keccak256(toHex(responseJsonString));

    let requestTxHash: string | undefined = job.requestTxHash || undefined;
    let responseTxHash: string | undefined = job.responseTxHash || undefined;
    let isRegisteredOnChain = false;
    let unsignedRequest: any = null;

    const validatorKey = getValidatorPrivateKey();
    const validatorAccount =
      options.validatorAccount ||
      (validatorKey ? privateKeyToAccount(validatorKey) : null);
    const validatorAddress =
      validatorAccount?.address ||
      process.env.VALIDATOR_ADDRESS ||
      '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5';

    if (options.skipOnChainBroadcast) {
      await releaseJobLease(slug, leaseToken);
      setMemoryValidationRecord({
        requestHash,
        status: job.status as ValidationJobStatus,
        score: job.score ?? validationResult.score,
        tag: job.tag ?? validationResult.tag,
        isRegisteredOnChain: false,
        requestTxHash,
        responseTxHash,
      });
      return {
        bundle,
        requestHash,
        validationResult,
        status: job.status as ValidationJobStatus,
        isRegisteredOnChain: false,
        requestTxHash,
        responseTxHash,
        unsignedRequest: job.unsignedRequest ? JSON.parse(job.unsignedRequest) : undefined,
      };
    }

    // 4. On-chain stage progression
    let requestExists = false;
    let onChainCompleted = false;

    try {
      const isComp = await publicClient.readContract({
        address: registryAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: 'isValidationComplete',
        args: [requestHash],
      });
      onChainCompleted = Boolean(isComp);

      const currentStatus = (await publicClient.readContract({
        address: registryAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: 'getValidationStatus',
        args: [requestHash],
      })) as readonly [string, bigint, number, string, string, bigint];

      requestExists =
        Boolean(currentStatus) &&
        Array.isArray(currentStatus) &&
        currentStatus[0] !== '0x0000000000000000000000000000000000000000' &&
        currentStatus[5] > 0n;
    } catch {
      requestExists = false;
      onChainCompleted = false;
    }

    // Check if already completed on chain
    if (onChainCompleted) {
      let statusData: any = null;
      try {
        statusData = await publicClient.readContract({
          address: registryAddress,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: 'getValidationStatus',
          args: [requestHash],
        });
      } catch {}

      const isArr = Array.isArray(statusData);
      const chainScore = isArr && typeof statusData[2] === 'number'
        ? statusData[2]
        : isArr && statusData[2] !== undefined
        ? Number(statusData[2])
        : (validationResult.score ?? 100);
      const chainTag = (isArr && statusData[4]) || validationResult.tag || 'verified-full';
      const respHash = (isArr && statusData[3]) || '0x0';
      const valAddr = (isArr && statusData[0]) || validatorAddress;
      const agId = isArr && statusData[1] !== undefined ? statusData[1].toString() : agentId.toString();

      await updateJobWithLease(slug, leaseToken, {
        status: 'RESPONSE_CONFIRMED',
        chainScore,
        chainTag,
        responseHash: respHash,
        validatorAddress: valAddr,
        agentId: agId,
      });
      await releaseJobLease(slug, leaseToken);

      setMemoryValidationRecord({
        requestHash,
        status: 'RESPONSE_CONFIRMED',
        score: chainScore,
        tag: chainTag,
        isRegisteredOnChain: true,
        requestTxHash,
        responseTxHash,
      });

      return {
        bundle,
        requestHash,
        validationResult,
        status: 'RESPONSE_CONFIRMED',
        isRegisteredOnChain: true,
        requestTxHash,
        responseTxHash,
        chainScore,
        chainTag,
        responseHash: respHash,
      };
    }

    // Stage LOCAL_EVALUATED -> REQUEST_PENDING / RESPONSE_PENDING
    if (!requestExists) {
      if (options.ownerWalletClient && options.ownerWalletClient.account) {
        const requestURI = `evidence/validation/${slug}.json`;
        requestTxHash = await options.ownerWalletClient.writeContract({
          address: registryAddress,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: 'validationRequest',
          args: [validatorAddress as `0x${string}`, agentId, requestURI, requestHash],
          chain: avalancheFuji,
          account: options.ownerWalletClient.account,
        });
        const reqReceipt = await publicClient.waitForTransactionReceipt({
          hash: requestTxHash as Hex,
        }).catch(() => null);

        if (reqReceipt && reqReceipt.status === 'success') {
          requestExists = true;
          job.status = 'RESPONSE_PENDING';
          await updateJobWithLease(slug, leaseToken, {
            requestTxHash,
            status: 'RESPONSE_PENDING',
          });
        } else {
          await updateJobWithLease(slug, leaseToken, {
            status: 'FAILED',
            failureReason: 'ValidationRequest transaction reverted on-chain',
          });
          await releaseJobLease(slug, leaseToken);
          return {
            bundle,
            requestHash,
            validationResult,
            status: 'FAILED',
            isRegisteredOnChain: false,
            failureReason: 'ValidationRequest transaction reverted on-chain',
          };
        }
      } else {
        // Backend does not hold owner key. Form unsigned request and set REQUEST_PENDING
        unsignedRequest = buildUnsignedValidationRequest({
          registryAddress,
          validatorAddress,
          agentId,
          slug,
          requestHash,
          ownerAddress: bundle.ownerAddress,
        });
        await updateJobWithLease(slug, leaseToken, {
          status: 'REQUEST_PENDING',
          unsignedRequest: serializeWithBigInt(unsignedRequest),
          validatorAddress,
          agentId: agentId.toString(),
        });
        await releaseJobLease(slug, leaseToken);
        return {
          bundle,
          requestHash,
          validationResult,
          status: 'REQUEST_PENDING',
          isRegisteredOnChain: false,
          unsignedRequest,
        };
      }
    } else {
      job.status = 'RESPONSE_PENDING';
      await updateJobWithLease(slug, leaseToken, {
        status: 'RESPONSE_PENDING',
      });
    }

    // Stage RESPONSE_PENDING: Validator submission & reconciliation
    // CRITICAL: UNKNOWN response cannot double-send!
    if (job.status === 'RESPONSE_PENDING' && validatorAccount) {
      if (job.responseTxHash) {
        // Stored responseTxHash exists: ONLY reconcile receipt, DO NOT call writeContract again!
        responseTxHash = job.responseTxHash;
        const receipt = await publicClient.getTransactionReceipt({
          hash: responseTxHash as Hex,
        }).catch(() => null);

        if (receipt && receipt.status === 'success') {
          const isComp = await publicClient.readContract({
            address: registryAddress,
            abi: VALIDATION_REGISTRY_ABI,
            functionName: 'isValidationComplete',
            args: [requestHash],
          });
          if (isComp) {
            const statusData = (await publicClient.readContract({
              address: registryAddress,
              abi: VALIDATION_REGISTRY_ABI,
              functionName: 'getValidationStatus',
              args: [requestHash],
            })) as readonly [string, bigint, number, string, string, bigint];

            const chainScore = Number(statusData[2]);
            const chainTag = statusData[4] || validationResult.tag;
            const respHash = statusData[3];

            await updateJobWithLease(slug, leaseToken, {
              status: 'RESPONSE_CONFIRMED',
              chainScore,
              chainTag,
              responseHash: respHash,
            });
            await releaseJobLease(slug, leaseToken);
            return {
              bundle,
              requestHash,
              validationResult,
              status: 'RESPONSE_CONFIRMED',
              isRegisteredOnChain: true,
              requestTxHash,
              responseTxHash,
              chainScore,
              chainTag,
              responseHash: respHash,
            };
          }
        } else if (receipt && receipt.status !== 'success') {
          if (job.retryCount < 3) {
            // Revert allows retry: clear responseTxHash so subsequent worker can retry
            await updateJobWithLease(slug, leaseToken, {
              responseTxHash: null,
              failureReason: 'Previous validationResponse reverted, queued for retry',
            });
          } else {
            await updateJobWithLease(slug, leaseToken, {
              status: 'FAILED',
              failureReason: 'ValidationResponse transaction reverted and max retries exceeded',
            });
            await releaseJobLease(slug, leaseToken);
            return {
              bundle,
              requestHash,
              validationResult,
              status: 'FAILED',
              isRegisteredOnChain: false,
              failureReason: 'ValidationResponse transaction reverted and max retries exceeded',
            };
          }
        } else {
          // Receipt not yet mined (still in mempool / pending): leave as RESPONSE_PENDING
          await releaseJobLease(slug, leaseToken);
          return {
            bundle,
            requestHash,
            validationResult,
            status: 'RESPONSE_PENDING',
            isRegisteredOnChain: false,
            requestTxHash,
            responseTxHash,
            failureReason: 'Awaiting response transaction mining',
          };
        }
      } else {
        // No prior responseTxHash: submit validator response on-chain
        const validatorWallet =
          options.validatorWalletClient ||
          createWalletClient({
            account: validatorAccount,
            chain: avalancheFuji,
            transport: http(rpcUrl),
          });

        const responseURI = `evidence/validation/${slug}.response.json`;
        try {
          responseTxHash = await validatorWallet.writeContract({
            address: registryAddress,
            abi: VALIDATION_REGISTRY_ABI,
            functionName: 'validationResponse',
            args: [
              requestHash,
              validationResult.score,
              responseURI,
              responseHash,
              validationResult.tag,
            ],
            chain: avalancheFuji,
            account: validatorAccount,
          });
        } catch (txErr: any) {
          await updateJobWithLease(slug, leaseToken, {
            status: 'FAILED',
            failureReason: `Response broadcast failed: ${txErr?.message || 'Transaction submission error'}`,
          });
          await releaseJobLease(slug, leaseToken);
          return {
            bundle,
            requestHash,
            validationResult,
            status: 'FAILED',
            isRegisteredOnChain: false,
            failureReason: `Response broadcast failed: ${txErr?.message || 'Transaction submission error'}`,
          };
        }

        // Save responseTxHash immediately in DB before waiting for receipt
        await updateJobWithLease(slug, leaseToken, {
          responseTxHash,
          status: 'RESPONSE_PENDING',
        });

        const respReceipt = await publicClient.waitForTransactionReceipt({
          hash: responseTxHash as Hex,
        }).catch(() => null);

        if (respReceipt && respReceipt.status === 'success') {
          const isComp = await publicClient.readContract({
            address: registryAddress,
            abi: VALIDATION_REGISTRY_ABI,
            functionName: 'isValidationComplete',
            args: [requestHash],
          });
          if (isComp) {
            const statusData = (await publicClient.readContract({
              address: registryAddress,
              abi: VALIDATION_REGISTRY_ABI,
              functionName: 'getValidationStatus',
              args: [requestHash],
            })) as readonly [string, bigint, number, string, string, bigint];

            const chainScore = Number(statusData[2]);
            const chainTag = statusData[4] || validationResult.tag;
            const respHash = statusData[3];

            await updateJobWithLease(slug, leaseToken, {
              status: 'RESPONSE_CONFIRMED',
              chainScore,
              chainTag,
              responseHash: respHash,
            });
            await releaseJobLease(slug, leaseToken);
            return {
              bundle,
              requestHash,
              validationResult,
              status: 'RESPONSE_CONFIRMED',
              isRegisteredOnChain: true,
              requestTxHash,
              responseTxHash,
              chainScore,
              chainTag,
              responseHash: respHash,
            };
          }
        }
      }
    }

    // Write evidence json to evidence/validation if accessible
    try {
      const evidenceDir = path.resolve(process.cwd(), 'evidence/validation');
      if (!fs.existsSync(evidenceDir)) {
        fs.mkdirSync(evidenceDir, { recursive: true });
      }
      const evidencePath = path.join(evidenceDir, `${slug}.response.json`);
      fs.writeFileSync(evidencePath, responseJsonString, 'utf8');
    } catch {}

    await releaseJobLease(slug, leaseToken);

    return {
      bundle,
      requestHash,
      validationResult,
      status: job.status as ValidationJobStatus,
      isRegisteredOnChain,
      requestTxHash,
      responseTxHash,
      unsignedRequest,
    };
  } catch (err: any) {
    await releaseJobLease(slug, leaseToken);
    throw err;
  }
}

/**
 * Standard entry point for running post-mission validation.
 */
export async function runMissionValidatorJob(
  slug: string,
  options: RunValidatorJobOptions = {}
): Promise<ValidatorJobResult> {
  return await advanceValidationJob(slug, options);
}

/**
 * Reconciles owner's validationRequest transaction on-chain:
 * 1. Verifies receipt: correct chain, success, target registry, sender is owner or agent.
 * 2. Verifies exact ValidationRequest event matching validator, agent, requestHash.
 * 3. Claims job lease atomically.
 * 4. Records requestTxHash, sets RESPONSE_PENDING.
 * 5. Uses advanceValidationJob to submit/reconcile response (preventing double-spend!).
 * 6. Releases lease.
 */
export async function reconcileOwnerValidationRequestReceipt(
  slug: string,
  txHash: string,
  options: {
    publicClient?: PublicClient;
    validatorWalletClient?: WalletClient;
    validatorAccount?: any;
    rpcUrl?: string;
  } = {}
): Promise<{
  success: boolean;
  status: ValidationJobStatus;
  requestTxHash?: string;
  responseTxHash?: string;
  error?: string;
}> {
  const job = await prisma.validationJob.findUnique({
    where: { missionSlug: slug },
    include: { mission: true },
  });

  if (!job) {
    return { success: false, status: 'FAILED', error: `ValidationJob not found for slug: ${slug}` };
  }

  // Refuse response until a valid persisted evaluation exists
  if (job.score === null || job.score === undefined || !job.tag) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: 'Cannot reconcile or respond for unevaluated job: score and tag must be persisted from evaluation',
    };
  }

  const rpcUrl =
    options.rpcUrl ||
    process.env.AVALANCHE_FUJI_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    'https://api.avax-test.network/ext/bc/C/rpc';

  const publicClient =
    options.publicClient ||
    createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

  // Verify chain ID
  try {
    const chainId = await publicClient.getChainId();
    if (chainId !== 43113) {
      return {
        success: false,
        status: job.status as ValidationJobStatus,
        error: `Chain ID mismatch: expected 43113, got ${chainId}`,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: `Failed to verify chain ID: ${err?.message || 'RPC error'}`,
    };
  }

  const registryAddress = getValidationRegistryAddress();

  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as Hex,
  }).catch(() => null);

  if (!receipt) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: 'Transaction receipt not found on chain',
    };
  }

  if (receipt.status !== 'success') {
    await prisma.validationJob.update({
      where: { missionSlug: slug },
      data: {
        status: 'FAILED',
        failureReason: 'Owner validationRequest transaction reverted on-chain',
      },
    });
    return { success: false, status: 'FAILED', error: 'Transaction reverted on-chain' };
  }

  if (!receipt.to || receipt.to.toLowerCase() !== registryAddress.toLowerCase()) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: `Transaction recipient mismatch: expected registry (${registryAddress}), got ${receipt.to}`,
    };
  }

  // Verify transaction sender is authorized owner or agent
  const sender = (receipt as any).from?.toLowerCase();
  const authorizedOwner = job.mission.ownerAddress.toLowerCase();
  const authorizedAgent = job.mission.agentAddress.toLowerCase();
  if (sender && sender !== authorizedOwner && sender !== authorizedAgent) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: `Unauthorized transaction sender: ${sender} is neither mission owner (${authorizedOwner}) nor agent (${authorizedAgent})`,
    };
  }

  // Decode ValidationRequest event in logs with exact validatorAddress, agentId, and requestHash
  let requestEventFound = false;
  const expectedValidator = (job.validatorAddress || getValidatorAddress()).toLowerCase();
  const expectedAgentId = (job.agentId || getErc8004AgentId().toString()).toLowerCase();
  const expectedRequestHash = job.requestHash.toLowerCase();

  for (const log of receipt.logs || []) {
    if (log.address && log.address.toLowerCase() !== registryAddress.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: [VALIDATION_REQUEST_EVENT_ABI],
        data: log.data,
        topics: log.topics,
      }) as any;

      if (decoded.eventName === 'ValidationRequest') {
        const evValidator = decoded.args.validatorAddress?.toLowerCase();
        const evAgentId = decoded.args.agentId?.toString().toLowerCase();
        const evReqHash = decoded.args.requestHash?.toLowerCase();

        if (
          evValidator === expectedValidator &&
          evAgentId === expectedAgentId &&
          evReqHash === expectedRequestHash
        ) {
          requestEventFound = true;
          break;
        }
      }
    } catch {}
  }

  if (!requestEventFound) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: 'Matching ValidationRequest event with exact validator, agentId, and requestHash not found in transaction logs',
    };
  }

  // Claim job lease atomically before advancing state
  const claim = await claimValidationJob(slug, 'owner-reconcile', 60_000);
  if (!claim) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: 'ValidationJob is currently locked by another worker process',
    };
  }

  try {
    // Record requestTxHash and advance to RESPONSE_PENDING
    await updateJobWithLease(slug, claim.leaseToken, {
      requestTxHash: txHash,
      status: 'RESPONSE_PENDING',
    });

    // Advance job through unified state machine (handles response without double-sending!)
    const result = await advanceValidationJob(slug, {
      ...options,
      leaseToken: claim.leaseToken,
    });

    return {
      success: result.status === 'RESPONSE_CONFIRMED' || result.status === 'RESPONSE_PENDING',
      status: result.status,
      requestTxHash: txHash,
      responseTxHash: result.responseTxHash,
    };
  } finally {
    await releaseJobLease(slug, claim.leaseToken);
  }
}

/**
 * Worker entry point to process queued or processable validation jobs with claim/lease semantics.
 */
export async function processQueuedValidationJobs(
  limit: number = 5,
  options: RunValidatorJobOptions = {}
): Promise<{ processed: number; results: ValidatorJobResult[] }> {
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const results: ValidatorJobResult[] = [];
  const processedSlugs = new Set<string>();

  for (let i = 0; i < limit; i++) {
    const claim = await claimNextValidationJob(workerId, 60_000, Array.from(processedSlugs));
    if (!claim) break;
    const slug = claim.missionSlug || claim.job?.missionSlug;
    processedSlugs.add(slug);

    try {
      const res = await advanceValidationJob(slug, {
        ...options,
        leaseToken: claim.leaseToken,
        workerId,
      });
      results.push(res);
    } catch (err: any) {
      await prisma.validationJob.updateMany({
        where: { id: claim.id || claim.job?.id, leaseToken: claim.leaseToken },
        data: {
          status: 'FAILED',
          failureReason: err?.message || 'Worker processing error',
          workerLeaseUntil: null,
          workerLeaseOwner: null,
          leaseToken: null,
        },
      });
      results.push({
        bundle: null as any,
        requestHash: (claim.requestHash || claim.job?.requestHash) as Hex,
        validationResult: null as any,
        status: 'FAILED',
        isRegisteredOnChain: false,
        failureReason: err?.message || 'Worker processing error',
      });
    }
  }

  return { processed: results.length, results };
}
