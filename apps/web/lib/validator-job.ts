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
  parseTransaction,
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

export interface FrozenValidationContext {
  version: 'MissionPay-frozen-v1';
  bundle: ValidationBundle;
  identities: {
    registryAddress: string;
    validatorAddress: string;
    agentId: string;
    ownerAddress: string;
    chainId: number;
    treasuryAddress: string;
  };
  range: {
    fromBlock?: string;
    toBlock?: string;
    snapshotBlock?: string;
  };
  provenance: {
    trustedCreationBlock?: string;
    trustedCreationTx?: string;
  };
  evidence?: {
    evaluatedAt: string;
    responseJsonString: string;
    responseHash: `0x${string}`;
    score: number;
    tag: string;
    checks: any;
    details: any;
  };
  preparedResponse?: PreparedResponseRecord;
}

export interface PreparedResponseRecord {
  preparedAt: string;
  txHash: `0x${string}`;
  rawTransaction: `0x${string}`;
  nonce: number;
  to: `0x${string}`;
  data: `0x${string}`;
  score: number;
  tag: string;
}

export function buildFrozenValidationContext(params: {
  bundle: ValidationBundle;
  registryAddress?: string;
  validatorAddress?: string;
  agentId?: string;
  ownerAddress?: string;
  chainId?: number;
  treasuryAddress?: string;
  fromBlock?: bigint;
  toBlock?: bigint;
  snapshotBlock?: bigint;
  trustedCreationBlock?: bigint;
  trustedCreationTx?: string;
}): FrozenValidationContext {
  return {
    version: 'MissionPay-frozen-v1',
    bundle: params.bundle,
    identities: {
      registryAddress: (params.registryAddress || getValidationRegistryAddress()).toLowerCase(),
      validatorAddress: (params.validatorAddress || getValidatorAddress()).toLowerCase(),
      agentId: (params.agentId || getErc8004AgentId().toString()).toLowerCase(),
      ownerAddress: (params.ownerAddress || params.bundle.ownerAddress || '').toLowerCase(),
      chainId: params.chainId ?? 43113,
      treasuryAddress: (params.treasuryAddress || params.bundle.treasury || getGuardedTreasuryAddress()).toLowerCase(),
    },
    range: {
      fromBlock: params.fromBlock?.toString() ?? (params.bundle.creationBlock?.toString()),
      toBlock: params.toBlock?.toString(),
      snapshotBlock: params.snapshotBlock?.toString(),
    },
    provenance: {
      trustedCreationBlock: params.trustedCreationBlock?.toString() ?? (params.bundle.creationBlock?.toString()),
      trustedCreationTx: params.trustedCreationTx,
    },
  };
}

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
  'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)'
);

export const VALIDATION_RESPONSE_EVENT_ABI_NO_URI = parseAbiItem(
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
  validatorPrivateKey?: Hex;
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
  isExternalResponse?: boolean;
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
 * Fenced update helper: ensures worker still holds an active, unexpired lease with matching token.
 */
async function updateJobWithLease(
  slug: string,
  leaseToken: string,
  data: any
) {
  const now = new Date();
  const res = await prisma.validationJob.updateMany({
    where: {
      missionSlug: slug,
      leaseToken,
      workerLeaseUntil: { gte: now },
    },
    data,
  });
  if (res.count === 0) {
    throw new Error(`Lease fencing error: lease ${leaseToken} on ${slug} was lost or expired`);
  }
}

/**
 * Renews active job lease for an unexpired lease holder.
 */
export async function renewJobLease(
  slug: string,
  leaseToken: string,
  durationMs: number = 60_000
): Promise<Date> {
  const now = new Date();
  const newUntil = new Date(now.getTime() + durationMs);
  const res = await prisma.validationJob.updateMany({
    where: {
      missionSlug: slug,
      leaseToken,
      workerLeaseUntil: { gte: now },
    },
    data: {
      workerLeaseUntil: newUntil,
    },
  });
  if (res.count === 0) {
    throw new Error(`Lease renewal error: lease ${leaseToken} on ${slug} was lost or expired`);
  }
  return newUntil;
}

/**
 * Allocates a serialized transaction nonce for the validator wallet across jobs.
 * Acquires a PostgreSQL advisory lock when available and checks active DB jobs.
 */
export async function allocateValidatorNonce(
  publicClient: any,
  validatorAddress: string
): Promise<number> {
  let acquiredLock = false;
  try {
    await prisma.$executeRawUnsafe(`SELECT pg_advisory_lock(hashtext('validator_nonce:${validatorAddress.toLowerCase()}'))`);
    acquiredLock = true;
  } catch {
    // Graceful fallback if PostgreSQL advisory locks not available in test harness
  }

  try {
    let onChainCount = 0;
    try {
      if (publicClient && typeof publicClient.getTransactionCount === 'function') {
        const count = await publicClient.getTransactionCount({
          address: validatorAddress as `0x${string}`,
          blockTag: 'pending',
        });
        onChainCount = Number(count);
      }
    } catch {
      try {
        if (publicClient && typeof publicClient.getTransactionCount === 'function') {
          const count = await publicClient.getTransactionCount({
            address: validatorAddress as `0x${string}`,
          });
          onChainCount = Number(count);
        }
      } catch {
        onChainCount = 0;
      }
    }

    // Inspect pending jobs in DB to ensure no nonce collision across parallel jobs
    let maxAllocatedNonce = -1;
    try {
      const pendingJobs = await prisma.validationJob.findMany({
        where: {
          status: { in: ['RESPONSE_PENDING', 'LOCAL_EVALUATED'] },
          responseTxHash: { not: null },
        },
        select: { frozenContext: true },
      });

      for (const pj of pendingJobs) {
        if (pj.frozenContext) {
          try {
            const parsed = JSON.parse(pj.frozenContext);
            if (
              parsed.identities?.validatorAddress?.toLowerCase() === validatorAddress.toLowerCase() &&
              parsed.preparedResponse?.nonce !== undefined
            ) {
              const n = Number(parsed.preparedResponse.nonce);
              if (!isNaN(n) && n > maxAllocatedNonce) {
                maxAllocatedNonce = n;
              }
            }
          } catch {}
        }
      }
    } catch {}

    return Math.max(isNaN(onChainCount) ? 0 : onChainCount, maxAllocatedNonce + 1);
  } finally {
    if (acquiredLock) {
      try {
        await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(hashtext('validator_nonce:${validatorAddress.toLowerCase()}'))`);
      } catch {}
    }
  }
}

export interface StrictChainResponseParams {
  publicClient: PublicClient;
  registryAddress: string;
  expectedValidator: string;
  expectedAgentId: string;
  expectedRequestHash: string;
  expectedChainId?: number;
  expectedResponseHash?: string;
  responseTxHash?: string;
}

export interface StrictChainResponseResult {
  isComplete: boolean;
  isConfirmed: boolean;
  isExternalResponse?: boolean;
  status: 'RESPONSE_CONFIRMED' | 'RESPONSE_PENDING' | 'FAILED' | 'UNAVAILABLE';
  chainScore?: number;
  chainTag?: string;
  responseHash?: string;
  validatorAddress?: string;
  agentId?: string;
  error?: string;
}

/**
 * Strict, centralized chain response verification for worker and owner reconciliation.
 * Eliminates all success fallbacks: missing/malformed status => UNAVAILABLE,
 * identity or hash mismatch => FAILED / not confirmed.
 */
export async function verifyStrictChainResponse(
  params: StrictChainResponseParams
): Promise<StrictChainResponseResult> {
  const expectedChainId = params.expectedChainId ?? 43113;
  try {
    const chainId = await params.publicClient.getChainId();
    if (chainId !== expectedChainId) {
      return {
        isComplete: false,
        isConfirmed: false,
        status: 'UNAVAILABLE',
        error: `Chain ID mismatch: expected ${expectedChainId}, got ${chainId}`,
      };
    }
  } catch (err: any) {
    return {
      isComplete: false,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: `Failed to query chainId: ${err?.message || err}`,
    };
  }

  let isComplete = false;
  try {
    const comp = await params.publicClient.readContract({
      address: params.registryAddress as `0x${string}`,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: 'isValidationComplete',
      args: [params.expectedRequestHash as `0x${string}`],
    });
    isComplete = Boolean(comp);
  } catch (err: any) {
    return {
      isComplete: false,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: `isValidationComplete RPC error: ${err?.message || err}`,
    };
  }

  if (!isComplete) {
    return {
      isComplete: false,
      isConfirmed: false,
      status: 'RESPONSE_PENDING',
    };
  }

  let statusTuple: readonly [string, bigint, number, string, string, bigint];
  try {
    const statusData = await params.publicClient.readContract({
      address: params.registryAddress as `0x${string}`,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: 'getValidationStatus',
      args: [params.expectedRequestHash as `0x${string}`],
    });
    statusTuple = statusData as any;
  } catch (err: any) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: `getValidationStatus RPC error: ${err?.message || err}`,
    };
  }

  if (!Array.isArray(statusTuple) || statusTuple.length < 6) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: 'Malformed getValidationStatus tuple from registry contract: tuple length < 6',
    };
  }

  const [valAddr, agId, scoreVal, respHash, tagVal, lastUpdate] = statusTuple;

  const isBytes32Hex = (h: any): boolean =>
    typeof h === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(h) &&
    h !== '0x0000000000000000000000000000000000000000000000000000000000000000';

  if (
    !valAddr ||
    typeof valAddr !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(valAddr) ||
    valAddr === '0x0000000000000000000000000000000000000000'
  ) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: `Invalid validatorAddress in getValidationStatus tuple: ${valAddr}`,
    };
  }

  if (valAddr.toLowerCase() !== params.expectedValidator.toLowerCase()) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'FAILED',
      error: `Validator address mismatch: expected ${params.expectedValidator}, got ${valAddr}`,
    };
  }

  if (typeof agId !== 'bigint' || agId < 0n) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: 'Invalid agentId in getValidationStatus tuple: must be non-negative bigint',
    };
  }

  if (agId.toString().toLowerCase() !== params.expectedAgentId.toLowerCase()) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'FAILED',
      error: `Agent ID mismatch: expected ${params.expectedAgentId}, got ${agId.toString()}`,
    };
  }

  if (typeof lastUpdate !== 'bigint' || lastUpdate <= 0n) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: 'Validation status uninitialized or empty on registry contract (lastUpdate <= 0)',
    };
  }

  const chainScore = typeof scoreVal === 'number' ? scoreVal : Number(scoreVal);
  if (!Number.isInteger(chainScore) || chainScore < 0 || chainScore > 100) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: `Invalid chain score in getValidationStatus tuple: ${scoreVal} (must be integer 0..100)`,
    };
  }

  if (!isBytes32Hex(respHash)) {
    return {
      isComplete: true,
      isConfirmed: false,
      status: 'UNAVAILABLE',
      error: `Missing or malformed bytes32 responseHash in getValidationStatus tuple: ${respHash}`,
    };
  }

  // Bind a response submitted by THIS job to its frozen evidence responseHash
  if (params.expectedResponseHash) {
    if (!isBytes32Hex(params.expectedResponseHash)) {
      return {
        isComplete: true,
        isConfirmed: false,
        status: 'UNAVAILABLE',
        error: `Expected responseHash is malformed bytes32: ${params.expectedResponseHash}`,
      };
    }

    if (respHash.toLowerCase() !== params.expectedResponseHash.toLowerCase()) {
      if (params.responseTxHash) {
        return {
          isComplete: true,
          isConfirmed: false,
          isExternalResponse: true,
          status: 'FAILED',
          chainScore,
          chainTag: tagVal || '',
          responseHash: respHash,
          validatorAddress: valAddr,
          agentId: agId.toString(),
          error: `On-chain responseHash (${respHash}) does not match frozen evidence responseHash (${params.expectedResponseHash})`,
        };
      } else {
        return {
          isComplete: true,
          isConfirmed: false,
          isExternalResponse: true,
          status: 'UNAVAILABLE',
          chainScore,
          chainTag: tagVal || '',
          responseHash: respHash,
          validatorAddress: valAddr,
          agentId: agId.toString(),
          error: `External on-chain response does not match frozen evidence responseHash (chain: ${respHash}, expected: ${params.expectedResponseHash})`,
        };
      }
    }
  }

  if (params.responseTxHash) {
    const receipt = await params.publicClient.getTransactionReceipt({
      hash: params.responseTxHash as `0x${string}`,
    }).catch(() => null);

    if (!receipt) {
      return {
        isComplete: true,
        isConfirmed: false,
        status: 'RESPONSE_PENDING',
        error: 'Response transaction receipt not yet mined',
      };
    }

    if (receipt.status !== 'success') {
      return {
        isComplete: true,
        isConfirmed: false,
        status: 'FAILED',
        error: 'Response transaction reverted on-chain',
      };
    }

    let matchingEventFound = false;
    for (const log of receipt.logs || []) {
      // Must match registry emitter address
      if (!log.address || log.address.toLowerCase() !== params.registryAddress.toLowerCase()) {
        continue;
      }
      try {
        let decoded: any = null;
        try {
          decoded = decodeEventLog({
            abi: [VALIDATION_RESPONSE_EVENT_ABI],
            data: log.data,
            topics: log.topics,
          });
        } catch {
          decoded = decodeEventLog({
            abi: [VALIDATION_RESPONSE_EVENT_ABI_NO_URI],
            data: log.data,
            topics: log.topics,
          });
        }

        if (decoded && decoded.eventName === 'ValidationResponse') {
          const evVal = decoded.args.validatorAddress?.toLowerCase();
          const evAg = decoded.args.agentId?.toString().toLowerCase();
          const evReqHash = decoded.args.requestHash?.toLowerCase();
          const evScore = Number(decoded.args.response);
          const evHash = decoded.args.responseHash?.toLowerCase();
          const evTag = decoded.args.tag;

          if (!isBytes32Hex(evHash)) {
            continue;
          }

          const matchesValidator = evVal === params.expectedValidator.toLowerCase();
          const matchesAgent = evAg === params.expectedAgentId.toLowerCase();
          const matchesReqHash = evReqHash === params.expectedRequestHash.toLowerCase();
          const matchesScore = evScore === chainScore;
          const matchesRespHash = evHash === respHash.toLowerCase();
          const matchesExpectedHash = !params.expectedResponseHash || evHash === params.expectedResponseHash.toLowerCase();
          const matchesTag = !tagVal || !evTag || evTag === tagVal;

          if (
            matchesValidator &&
            matchesAgent &&
            matchesReqHash &&
            matchesScore &&
            matchesRespHash &&
            matchesExpectedHash &&
            matchesTag
          ) {
            matchingEventFound = true;
            break;
          }
        }
      } catch {}
    }

    if (!matchingEventFound) {
      return {
        isComplete: true,
        isConfirmed: false,
        status: 'FAILED',
        error: 'Matching ValidationResponse event with exact registry emitter, validator, agentId, requestHash, score, responseHash, and tag not found in transaction logs',
      };
    }
  }

  return {
    isComplete: true,
    isConfirmed: true,
    status: 'RESPONSE_CONFIRMED',
    chainScore,
    chainTag: tagVal || '',
    responseHash: respHash,
    validatorAddress: valAddr,
    agentId: agId.toString(),
  };
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
  const validatorKey =
    options.validatorPrivateKey ||
    getValidatorPrivateKey() ||
    (process.env.AGENT_PRIVATE_KEY as Hex) ||
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const validatorAccount =
    options.validatorAccount ||
    privateKeyToAccount(validatorKey);
  const validatorAddress =
    validatorAccount?.address ||
    process.env.VALIDATOR_ADDRESS ||
    '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5';
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
    let context: FrozenValidationContext;
    let bundle: ValidationBundle;
    if (job.frozenContext) {
      try {
        const parsed = JSON.parse(job.frozenContext);
        if (parsed.version === 'MissionPay-frozen-v1' && parsed.bundle) {
          context = parsed;
          bundle = parsed.bundle;
        } else {
          bundle = parsed;
          context = buildFrozenValidationContext({
            bundle,
            registryAddress: job.registryAddress || registryAddress,
            validatorAddress: job.validatorAddress || validatorAddress,
            agentId: job.agentId || agentId.toString(),
            ownerAddress: bundle.ownerAddress || mission.ownerAddress,
            chainId: 43113,
            treasuryAddress: bundle.treasury,
          });
        }
      } catch (err: any) {
        throw new Error(`MALFORMED_FROZEN_CONTEXT: could not parse persisted frozen context: ${err?.message || err}`);
      }

      // Check for stale context mutation: mission state
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

      if (mission.treasuryCap && bundle.cap && mission.treasuryCap.toString() !== bundle.cap.toString()) {
        await updateJobWithLease(slug, leaseToken, {
          status: 'STALE_CONTEXT',
          failureReason: 'STALE_CONTEXT: mission treasuryCap mutated after validation job was frozen',
        });
        await releaseJobLease(slug, leaseToken);
        return {
          bundle,
          requestHash: job.requestHash as Hex,
          validationResult: { valid: false, score: 0, checks: {} as any, tag: 'STALE_CONTEXT', details: {} as any },
          status: 'STALE_CONTEXT',
          isRegisteredOnChain: false,
          failureReason: 'STALE_CONTEXT: mission treasuryCap mutated after validation job was frozen',
        };
      }

      // Check configured identities vs frozen identities
      if (
        context.identities &&
        (
          (context.identities.registryAddress && context.identities.registryAddress.toLowerCase() !== registryAddress.toLowerCase()) ||
          (context.identities.validatorAddress && context.identities.validatorAddress.toLowerCase() !== validatorAddress.toLowerCase()) ||
          (context.identities.agentId && context.identities.agentId.toLowerCase() !== agentId.toString().toLowerCase()) ||
          (context.identities.ownerAddress && mission.ownerAddress && context.identities.ownerAddress.toLowerCase() !== mission.ownerAddress.toLowerCase()) ||
          (context.identities.chainId && context.identities.chainId !== 43113)
        )
      ) {
        const reason = `STALE_CONTEXT: configured identities or chainId mutated after validation job was frozen`;
        await updateJobWithLease(slug, leaseToken, {
          status: 'STALE_CONTEXT',
          failureReason: reason,
        });
        await releaseJobLease(slug, leaseToken);
        return {
          bundle,
          requestHash: job.requestHash as Hex,
          validationResult: { valid: false, score: 0, checks: {} as any, tag: 'STALE_CONTEXT', details: {} as any },
          status: 'STALE_CONTEXT',
          isRegisteredOnChain: false,
          failureReason: reason,
        };
      }
    } else {
      bundle = await buildMissionValidationBundle(slug, {
        tamperAuditHead: options.tamperAuditHead,
        tamperPayeeRoot: options.tamperPayeeRoot,
      });
      context = buildFrozenValidationContext({
        bundle,
        registryAddress,
        validatorAddress,
        agentId: agentId.toString(),
        ownerAddress: mission.ownerAddress,
        chainId: 43113,
        treasuryAddress: bundle.treasury,
        fromBlock: bundle.creationBlock,
      });
      await updateJobWithLease(slug, leaseToken, {
        frozenContext: serializeWithBigInt(context),
      });
    }

    const requestHash = computeValidationRequestHash(bundle);

    // 3. Local Evaluation Step (evaluated once and frozen into context)
    let validationResult: ValidationCheckResult;
    const shouldEvaluate =
      (job.status === 'QUEUED' || job.status === 'LOCAL_EVALUATING' || !job.evaluationResult) &&
      !context.evidence;

    if (shouldEvaluate) {
      await renewJobLease(slug, leaseToken, 60_000);
      try {
        validationResult = await validateBundleOnChain(
          publicClient,
          bundle,
          options.fromBlock ?? (job.fromBlock ? BigInt(job.fromBlock) : (bundle.creationBlock ?? undefined)),
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

      context.evidence = {
        evaluatedAt: responseData.evaluatedAt,
        responseJsonString,
        responseHash,
        score: validationResult.score,
        tag: validationResult.tag,
        checks: validationResult.checks,
        details: validationResult.details,
      };
      context.range = {
        fromBlock: fromBlockBigInt?.toString(),
        toBlock: toBlockBigInt?.toString(),
        snapshotBlock: snapshotBlockBigInt?.toString(),
      };

      await updateJobWithLease(slug, leaseToken, {
        status: 'LOCAL_EVALUATED',
        evaluationResult: serializeWithBigInt(validationResult),
        frozenContext: serializeWithBigInt(context),
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
    } else if (job.evaluationResult) {
      validationResult = JSON.parse(job.evaluationResult);
    } else if (context.evidence) {
      validationResult = {
        valid: (context.evidence.score ?? 0) > 0,
        score: context.evidence.score ?? 0,
        tag: context.evidence.tag || 'verified-full',
        checks: (context.evidence.checks || {}) as any,
        details: (context.evidence.details || {}) as any,
      };
    } else {
      validationResult = {
        valid: false,
        score: job.score ?? 0,
        tag: job.tag ?? 'unknown',
        checks: {} as any,
        details: {} as any,
      };
    }

    // Reuse frozen evidence payload and hash
    const responseJsonString = context.evidence?.responseJsonString || serializeWithBigInt({
      requestHash,
      missionId: bundle.missionId,
      missionSlug: bundle.missionSlug,
      evaluatedAt: new Date().toISOString(),
      agentId: agentId.toString(),
      score: validationResult.score,
      tag: validationResult.tag,
      checks: validationResult.checks,
      details: validationResult.details,
    }, 2);
    const responseHash = (context.evidence?.responseHash || keccak256(toHex(responseJsonString))) as `0x${string}`;

    let requestTxHash: string | undefined = job.requestTxHash || undefined;
    let responseTxHash: string | undefined = job.responseTxHash || undefined;
    let isRegisteredOnChain = false;
    let unsignedRequest: any = null;

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
    // Centralized strict check of registry contract status
    const chainCheck = await verifyStrictChainResponse({
      publicClient,
      registryAddress,
      expectedValidator: validatorAddress,
      expectedAgentId: agentId.toString(),
      expectedRequestHash: requestHash,
      expectedChainId: 43113,
      expectedResponseHash: responseHash,
    });

    if (chainCheck.isConfirmed) {
      await updateJobWithLease(slug, leaseToken, {
        status: 'RESPONSE_CONFIRMED',
        chainScore: chainCheck.chainScore,
        chainTag: chainCheck.chainTag,
        responseHash: chainCheck.responseHash,
        validatorAddress: chainCheck.validatorAddress,
        agentId: chainCheck.agentId,
      });
      await releaseJobLease(slug, leaseToken);

      setMemoryValidationRecord({
        requestHash,
        status: 'RESPONSE_CONFIRMED',
        score: chainCheck.chainScore,
        tag: chainCheck.chainTag,
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
        chainScore: chainCheck.chainScore,
        chainTag: chainCheck.chainTag,
        responseHash: chainCheck.responseHash,
        isExternalResponse: chainCheck.isExternalResponse,
      };
    }

    // Check if request exists on chain
    let requestExists = false;
    try {
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
    }

    if (!requestExists) {
      if (options.ownerWalletClient && options.ownerWalletClient.account) {
        await renewJobLease(slug, leaseToken, 60_000);
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

    // Stage RESPONSE_PENDING: Validator submission & strict reconciliation
    // CRITICAL: UNKNOWN response cannot double-send! Same raw transaction identity reused on restart.
    if (job.status === 'RESPONSE_PENDING' && validatorAccount) {
      await renewJobLease(slug, leaseToken, 60_000);

      if (context.preparedResponse?.rawTransaction) {
        // Stored deterministic raw transaction exists: ONLY reconcile or rebroadcast EXACT bytes, NEVER sign a fresh tx!
        const prepared = context.preparedResponse;
        responseTxHash = prepared.txHash;

        const strictCheck = await verifyStrictChainResponse({
          publicClient,
          registryAddress,
          expectedValidator: validatorAddress,
          expectedAgentId: agentId.toString(),
          expectedRequestHash: requestHash,
          expectedChainId: 43113,
          expectedResponseHash: responseHash,
          responseTxHash,
        });

        if (strictCheck.isConfirmed) {
          await updateJobWithLease(slug, leaseToken, {
            status: 'RESPONSE_CONFIRMED',
            chainScore: strictCheck.chainScore,
            chainTag: strictCheck.chainTag,
            responseHash: strictCheck.responseHash,
            validatorAddress: strictCheck.validatorAddress,
            agentId: strictCheck.agentId,
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
            chainScore: strictCheck.chainScore,
            chainTag: strictCheck.chainTag,
            responseHash: strictCheck.responseHash,
          };
        } else if (strictCheck.status === 'FAILED') {
          if (job.retryCount < 3) {
            // Revert allows retry: clear preparedResponse so subsequent worker can prepare fresh
            delete context.preparedResponse;
            await updateJobWithLease(slug, leaseToken, {
              frozenContext: serializeWithBigInt(context),
              responseTxHash: null,
              failureReason: strictCheck.error || 'Previous validationResponse reverted, queued for retry',
            });
          } else {
            await updateJobWithLease(slug, leaseToken, {
              status: 'FAILED',
              failureReason: strictCheck.error || 'ValidationResponse transaction reverted and max retries exceeded',
            });
            await releaseJobLease(slug, leaseToken);
            return {
              bundle,
              requestHash,
              validationResult,
              status: 'FAILED',
              isRegisteredOnChain: false,
              failureReason: strictCheck.error || 'ValidationResponse transaction reverted and max retries exceeded',
            };
          }
        } else {
          // Transaction not yet confirmed: rebroadcast EXACT stored rawTransaction bytes
          const broadcastClient = options.validatorWalletClient || publicClient;
          try {
            if (typeof broadcastClient.sendRawTransaction === 'function') {
              await broadcastClient.sendRawTransaction({
                serializedTransaction: prepared.rawTransaction,
              });
            }
          } catch (err: any) {
            const msg = err?.message || String(err);
            if (!/already known|nonce too low|known transaction/i.test(msg)) {
              console.warn('[Validation Worker] Rebroadcast notice:', msg);
            }
          }

          // Re-check after rebroadcast attempt
          const recheck = await verifyStrictChainResponse({
            publicClient,
            registryAddress,
            expectedValidator: validatorAddress,
            expectedAgentId: agentId.toString(),
            expectedRequestHash: requestHash,
            expectedChainId: 43113,
            expectedResponseHash: responseHash,
            responseTxHash,
          });

          if (recheck.isConfirmed) {
            await updateJobWithLease(slug, leaseToken, {
              status: 'RESPONSE_CONFIRMED',
              chainScore: recheck.chainScore,
              chainTag: recheck.chainTag,
              responseHash: recheck.responseHash,
              validatorAddress: recheck.validatorAddress,
              agentId: recheck.agentId,
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
              chainScore: recheck.chainScore,
              chainTag: recheck.chainTag,
              responseHash: recheck.responseHash,
            };
          }

          await releaseJobLease(slug, leaseToken);
          return {
            bundle,
            requestHash,
            validationResult,
            status: 'RESPONSE_PENDING',
            isRegisteredOnChain: false,
            requestTxHash,
            responseTxHash,
            failureReason: recheck.error || 'Awaiting response transaction mining',
          };
        }
      } else {
        // FIRST TIME: locally prepare, sign, and persist REAL raw transaction BEFORE broadcast
        const responseURI = `evidence/validation/${slug}.response.json`;
        const preparedTxData = encodeFunctionData({
          abi: VALIDATION_REGISTRY_ABI,
          functionName: 'validationResponse',
          args: [
            requestHash,
            validationResult.score,
            responseURI,
            responseHash,
            validationResult.tag,
          ],
        });

        // Allocate serialized nonce for this validator wallet across jobs
        const nonce = await allocateValidatorNonce(publicClient, validatorAddress);

        let maxFeePerGas = 35_000_000_000n;
        let maxPriorityFeePerGas = 2_000_000_000n;
        try {
          if (typeof publicClient.estimateFeesPerGas === 'function') {
            const fees = await publicClient.estimateFeesPerGas();
            if (fees.maxFeePerGas) maxFeePerGas = fees.maxFeePerGas;
            if (fees.maxPriorityFeePerGas) maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
          }
        } catch {}

        let gas = 350_000n;
        try {
          if (typeof publicClient.estimateGas === 'function') {
            const est = await publicClient.estimateGas({
              account: validatorAccount,
              to: registryAddress as `0x${string}`,
              data: preparedTxData,
            });
            gas = (est * 125n) / 100n;
          }
        } catch {
          gas = 500_000n;
        }

        const signingAccount = typeof validatorAccount.signTransaction === 'function'
          ? validatorAccount
          : privateKeyToAccount(validatorKey);

        const rawTransaction = await signingAccount.signTransaction({
          to: registryAddress as `0x${string}`,
          data: preparedTxData,
          value: 0n,
          nonce,
          gas,
          maxFeePerGas,
          maxPriorityFeePerGas,
          chainId: 43113,
        });

        const realTxHash = keccak256(rawTransaction);

        context.preparedResponse = {
          preparedAt: new Date().toISOString(),
          txHash: realTxHash,
          rawTransaction,
          nonce,
          to: registryAddress as `0x${string}`,
          data: preparedTxData,
          score: validationResult.score,
          tag: validationResult.tag,
        };

        // Persist real signed bytes and actual hash in private durable storage BEFORE external submission
        await renewJobLease(slug, leaseToken, 60_000);
        await updateJobWithLease(slug, leaseToken, {
          frozenContext: serializeWithBigInt(context),
          responseTxHash: realTxHash,
          status: 'RESPONSE_PENDING',
        });

        responseTxHash = realTxHash;

        // Broadcast via raw transaction transport
        const broadcastClient = options.validatorWalletClient || publicClient;
        try {
          if (typeof broadcastClient.sendRawTransaction === 'function') {
            await broadcastClient.sendRawTransaction({
              serializedTransaction: rawTransaction,
            });
          } else if (typeof (broadcastClient as any).writeContract === 'function') {
            await (broadcastClient as any).writeContract({
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
          }
        } catch (txErr: any) {
          const msg = txErr?.message || String(txErr);
          if (!/already known|nonce too low|known transaction/i.test(msg)) {
            if (/RPC_GAS_ESTIMATION_FAILED|revert|execution reverted/i.test(msg)) {
              await updateJobWithLease(slug, leaseToken, {
                status: 'FAILED',
                failureReason: `Response broadcast failed: ${msg}`,
              });
              await releaseJobLease(slug, leaseToken);
              return {
                bundle,
                requestHash,
                validationResult,
                status: 'FAILED',
                isRegisteredOnChain: false,
                failureReason: `Response broadcast failed: ${msg}`,
              };
            } else {
              // Ambiguous network crash or transport drop during sendRawTransaction:
              // Job stays in RESPONSE_PENDING with prepared signed raw transaction identity intact for restart rebroadcast.
              await updateJobWithLease(slug, leaseToken, {
                status: 'RESPONSE_PENDING',
                failureReason: `Response broadcast error: ${msg}`,
              });
              await releaseJobLease(slug, leaseToken);
              return {
                bundle,
                requestHash,
                validationResult,
                status: 'RESPONSE_PENDING',
                isRegisteredOnChain: false,
                responseTxHash: realTxHash,
                failureReason: `Response broadcast error: ${msg}`,
              };
            }
          }
        }

        // Strictly verify response using verifyStrictChainResponse
        const strictRespCheck = await verifyStrictChainResponse({
          publicClient,
          registryAddress,
          expectedValidator: validatorAddress,
          expectedAgentId: agentId.toString(),
          expectedRequestHash: requestHash,
          expectedChainId: 43113,
          expectedResponseHash: responseHash,
          responseTxHash: realTxHash,
        });

        if (strictRespCheck.isConfirmed) {
          await updateJobWithLease(slug, leaseToken, {
            status: 'RESPONSE_CONFIRMED',
            chainScore: strictRespCheck.chainScore,
            chainTag: strictRespCheck.chainTag,
            responseHash: strictRespCheck.responseHash,
            validatorAddress: strictRespCheck.validatorAddress,
            agentId: strictRespCheck.agentId,
          });
          await releaseJobLease(slug, leaseToken);

          setMemoryValidationRecord({
            requestHash,
            status: 'RESPONSE_CONFIRMED',
            score: strictRespCheck.chainScore,
            tag: strictRespCheck.chainTag,
            isRegisteredOnChain: true,
            requestTxHash,
            responseTxHash: realTxHash,
          });

          return {
            bundle,
            requestHash,
            validationResult,
            status: 'RESPONSE_CONFIRMED',
            isRegisteredOnChain: true,
            requestTxHash,
            responseTxHash: realTxHash,
            chainScore: strictRespCheck.chainScore,
            chainTag: strictRespCheck.chainTag,
            responseHash: strictRespCheck.responseHash,
          };
        } else if (strictRespCheck.status === 'FAILED') {
          await updateJobWithLease(slug, leaseToken, {
            status: 'FAILED',
            failureReason: strictRespCheck.error || 'ValidationResponse transaction reverted on-chain',
          });
          await releaseJobLease(slug, leaseToken);
          return {
            bundle,
            requestHash,
            validationResult,
            status: 'FAILED',
            isRegisteredOnChain: false,
            failureReason: strictRespCheck.error || 'ValidationResponse transaction reverted on-chain',
          };
        } else {
          // Awaiting mining
          await releaseJobLease(slug, leaseToken);
          return {
            bundle,
            requestHash,
            validationResult,
            status: 'RESPONSE_PENDING',
            isRegisteredOnChain: false,
            requestTxHash,
            responseTxHash: realTxHash,
            failureReason: strictRespCheck.error || 'Awaiting response transaction mining',
          };
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
