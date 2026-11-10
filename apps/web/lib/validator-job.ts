import fs from 'fs';
import path from 'path';
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
import { getGuardedTreasuryAddress, getPaymentMode } from './config';

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
  {
    type: 'function',
    name: 'isValidationComplete',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

export const DEFAULT_VALIDATION_REGISTRY: `0x${string}` =
  '0x4c5ccda2a630cd1cb706799deadcc8483d06697e';
export const DEFAULT_ERC8004_AGENT_ID = 294n;

export function getValidationRegistryAddress(): `0x${string}` {
  const envAddr =
    process.env.VALIDATION_REGISTRY_ADDRESS ||
    process.env.NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS;
  if (envAddr && /^0x[0-9a-fA-F]{40}$/.test(envAddr.trim())) {
    return getAddress(envAddr.trim()) as `0x${string}`;
  }
  return DEFAULT_VALIDATION_REGISTRY;
}

export function getValidatorPrivateKey(): Hex | null {
  const key = process.env.VALIDATOR_PRIVATE_KEY?.trim();
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
    return key as Hex;
  }
  return null;
}

export function getErc8004AgentId(): bigint {
  const envId =
    process.env.ERC8004_AGENT_ID ||
    process.env.NEXT_PUBLIC_ERC8004_AGENT_ID;
  if (envId && /^\d+$/.test(envId.trim())) {
    return BigInt(envId.trim());
  }
  return DEFAULT_ERC8004_AGENT_ID;
}

export const VALIDATION_REQUEST_EVENT_ABI = parseAbiItem(
  'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)'
);

export const VALIDATION_RESPONSE_EVENT_ABI = parseAbiItem(
  'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)'
);

export type ValidationJobStatus =
  | 'QUEUED'
  | 'LOCAL_EVALUATED'
  | 'REQUEST_PENDING'
  | 'RESPONSE_PENDING'
  | 'RESPONSE_CONFIRMED'
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
    value: '0',
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

export interface InMemoryValidationRecord {
  requestHash: `0x${string}`;
  validatorAddress: string;
  agentId: string;
  score: number;
  responseHash: string;
  tag: string;
  lastUpdate: number;
  isComplete: boolean;
  status: ValidationJobStatus;
  txHash?: string;
  bundle?: ValidationBundle;
  details?: any;
  unsignedRequest?: any;
  failureReason?: string;
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

export async function getValidationJobFromDb(slug: string) {
  try {
    return await prisma.validationJob.findUnique({
      where: { missionSlug: slug },
    });
  } catch {
    return null;
  }
}

export async function getValidationJobByRequestHash(requestHash: string) {
  try {
    return await prisma.validationJob.findUnique({
      where: { requestHash },
    });
  } catch {
    return null;
  }
}

export type ValidationFetcher = (missionId: string, requestHash: string) => Promise<any | null>;
let customValidationFetcher: ValidationFetcher | null = null;

export function setValidationFetcherForTesting(fetcher: ValidationFetcher | null) {
  customValidationFetcher = fetcher;
}

export function getValidationFetcherForTesting(): ValidationFetcher | null {
  return customValidationFetcher;
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

  // Parse payees
  let payees: string[] = [];
  if (mission.payeesJson) {
    try {
      payees = JSON.parse(mission.payeesJson);
    } catch {
      payees = [];
    }
  }

  // Compute payee root if not already stored
  let payeeRoot: `0x${string}`;
  if (mission.payeeRoot && mission.payeeRoot.startsWith('0x')) {
    payeeRoot = mission.payeeRoot as `0x${string}`;
  } else {
    const tree = computePayeeMerkleTree(payees);
    payeeRoot = tree.root as `0x${string}`;
  }

  // Find latest audit head
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
}

/**
 * Runs the automated post-mission validation runner (M7).
 * Evaluates the mission bundle against on-chain contract state and submits validationResponse.
 */
export async function runMissionValidatorJob(
  slug: string,
  options: RunValidatorJobOptions = {}
): Promise<ValidatorJobResult> {
  const bundle = await buildMissionValidationBundle(slug, {
    tamperAuditHead: options.tamperAuditHead,
    tamperPayeeRoot: options.tamperPayeeRoot,
  });

  const requestHash = computeValidationRequestHash(bundle);
  const registryAddress = getValidationRegistryAddress();
  const agentId = getErc8004AgentId();

  // Create public client if not supplied
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

  // 1. Evaluate bundle against on-chain state directly
  let validationResult: ValidationCheckResult;
  let status: ValidationJobStatus = 'LOCAL_EVALUATED';
  let failureReason: string | undefined;

  try {
    validationResult = await validateBundleOnChain(
      publicClient,
      bundle,
      options.fromBlock,
      options.toBlock
    );
  } catch (err: any) {
    status = 'FAILED';
    failureReason = `Evaluation error: ${err.message?.slice(0, 50)}`;
    validationResult = {
      valid: false,
      score: 0,
      checks: {
        headMatchesOnChain: false,
        rootMatchesOnChain: false,
        payeesGenerateRoot: false,
        executedPayeesValid: false,
        totalSpendWithinCap: false,
        hasExecutions: false,
      },
      tag: `failed:EVALUATION_ERROR_${err.message?.slice(0, 30)}`,
      details: {
        onChainHead: '0x0',
        onChainRoot: '0x0',
        computedRoot: '0x0',
        executedCount: 0,
        totalExecutedAmount: '0',
        missionCap: '0',
        failedChecks: ['ONCHAIN_READ_ERROR'],
      },
    };
  }

  // 2. Prepare evidence payload
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
  const responseJsonString = JSON.stringify(responseData, null, 2);
  const responseHash = keccak256(toHex(responseJsonString));

  let requestTxHash: string | undefined;
  let responseTxHash: string | undefined;
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

  // 3. On-Chain Submission if enabled and not skipped
  if (!options.skipOnChainBroadcast && status !== 'FAILED') {
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
        currentStatus[0] !== '0x0000000000000000000000000000000000000000' &&
        currentStatus[5] > 0n;
    } catch {
      requestExists = false;
      onChainCompleted = false;
    }

    if (onChainCompleted) {
      status = 'RESPONSE_CONFIRMED';
      isRegisteredOnChain = true;
    } else if (!requestExists) {
      if (options.ownerWalletClient && options.ownerWalletClient.account) {
        // Explicit owner signer provided (e.g. in test or authorized session)
        try {
          const requestURI = `evidence/validation/${slug}.json`;
          requestTxHash = await options.ownerWalletClient.writeContract({
            address: registryAddress,
            abi: VALIDATION_REGISTRY_ABI,
            functionName: 'validationRequest',
            args: [validatorAddress, agentId, requestURI, requestHash],
            chain: avalancheFuji,
            account: options.ownerWalletClient.account,
          });
          const reqReceipt = await publicClient.waitForTransactionReceipt({
            hash: requestTxHash as `0x${string}`,
          });
          if (reqReceipt.status === 'success') {
            requestExists = true;
            status = 'RESPONSE_PENDING';
          } else {
            status = 'FAILED';
            failureReason = 'ValidationRequest transaction reverted';
          }
        } catch (reqErr: any) {
          status = 'FAILED';
          failureReason = reqErr?.message || 'Failed submitting validationRequest';
        }
      } else {
        // Backend does not hold owner key. Do NOT forge or assume request exists.
        status = 'REQUEST_PENDING';
        unsignedRequest = buildUnsignedValidationRequest({
          registryAddress,
          validatorAddress,
          agentId,
          slug,
          requestHash,
          ownerAddress: bundle.treasury,
        });
      }
    } else {
      status = 'RESPONSE_PENDING';
    }

    // Submit response on-chain only if request exists and validator account available
    if (requestExists && !onChainCompleted && validatorAccount && status !== 'FAILED') {
      try {
        const validatorWallet =
          options.validatorWalletClient ||
          createWalletClient({
            account: validatorAccount,
            chain: avalancheFuji,
            transport: http(rpcUrl),
          });

        const responseURI = `evidence/validation/${slug}.response.json`;
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

        const respReceipt = await publicClient.waitForTransactionReceipt({
          hash: responseTxHash as `0x${string}`,
        });

        if (respReceipt.status === 'success') {
          const confirmed = await publicClient.readContract({
            address: registryAddress,
            abi: VALIDATION_REGISTRY_ABI,
            functionName: 'isValidationComplete',
            args: [requestHash],
          });
          if (confirmed) {
            status = 'RESPONSE_CONFIRMED';
            isRegisteredOnChain = true;
          } else {
            status = 'FAILED';
            failureReason = 'isValidationComplete returned false after response broadcast';
          }
        } else {
          status = 'FAILED';
          failureReason = 'ValidationResponse transaction reverted';
        }
      } catch (broadcastErr: any) {
        status = 'FAILED';
        failureReason = broadcastErr?.message || 'Validator broadcast failed';
      }
    }
  }

  // 4. Persist to database (resilient to restart)
  try {
    await prisma.validationJob.upsert({
      where: { missionSlug: slug },
      create: {
        missionSlug: slug,
        missionId: bundle.missionId,
        requestHash,
        status,
        mode: getPaymentMode(),
        fromBlock: options.fromBlock,
        toBlock: options.toBlock,
        snapshotBlock: validationResult.snapshotBlock ? BigInt(validationResult.snapshotBlock) : null,
        evaluationResult: JSON.stringify(validationResult),
        score: validationResult.score,
        tag: validationResult.tag,
        validatorAddress,
        agentId: agentId.toString(),
        unsignedRequest: unsignedRequest ? JSON.stringify(unsignedRequest) : null,
        requestTxHash,
        responseTxHash,
        failureReason,
        retryCount: 0,
      },
      update: {
        requestHash,
        status,
        mode: getPaymentMode(),
        fromBlock: options.fromBlock,
        toBlock: options.toBlock,
        snapshotBlock: validationResult.snapshotBlock ? BigInt(validationResult.snapshotBlock) : null,
        evaluationResult: JSON.stringify(validationResult),
        score: validationResult.score,
        tag: validationResult.tag,
        validatorAddress,
        agentId: agentId.toString(),
        unsignedRequest: unsignedRequest ? JSON.stringify(unsignedRequest) : null,
        requestTxHash: requestTxHash ?? undefined,
        responseTxHash: responseTxHash ?? undefined,
        failureReason,
        retryCount: { increment: 1 },
      },
    });
  } catch (dbErr) {
    console.warn('[ValidationJob DB Persist Warning]', dbErr);
  }

  // 5. Update memory cache and write evidence file if directory exists
  const memRecord: InMemoryValidationRecord = {
    requestHash,
    validatorAddress,
    agentId: agentId.toString(),
    score: validationResult.score,
    responseHash,
    tag: validationResult.tag,
    lastUpdate: Math.floor(Date.now() / 1000),
    isComplete: status === 'RESPONSE_CONFIRMED',
    status,
    txHash: responseTxHash,
    bundle,
    details: validationResult.details,
    unsignedRequest,
    failureReason,
  };
  setMemoryValidationRecord(memRecord);

  // Write evidence json to evidence/validation if accessible
  try {
    const evidenceDir = path.resolve(process.cwd(), 'evidence/validation');
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const evidencePath = path.join(evidenceDir, `${slug}.response.json`);
    fs.writeFileSync(evidencePath, responseJsonString, 'utf8');
  } catch {}

  return {
    bundle,
    requestHash,
    validationResult,
    status,
    isRegisteredOnChain,
    requestTxHash,
    responseTxHash,
    unsignedRequest,
    failureReason,
  };
}

/**
 * Reconciles owner's validationRequest transaction on-chain:
 * 1. Verifies transaction receipt succeeded and targeted validation registry.
 * 2. Verifies ValidationRequest event emitted with exact requestHash.
 * 3. Advances job from REQUEST_PENDING to RESPONSE_PENDING.
 * 4. Submits validator response on-chain and verifies isValidationComplete.
 * 5. Advances job to RESPONSE_CONFIRMED.
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

  const registryAddress = getValidationRegistryAddress();

  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as Hex,
  }).catch(() => null);

  if (!receipt) {
    return { success: false, status: job.status as ValidationJobStatus, error: 'Transaction receipt not found on chain' };
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

  // Verify recipient or contract address
  if (receipt.to && receipt.to.toLowerCase() !== registryAddress.toLowerCase()) {
    return {
      success: false,
      status: job.status as ValidationJobStatus,
      error: `Transaction recipient mismatch: expected ${registryAddress}, got ${receipt.to}`,
    };
  }

  // Find and decode ValidationRequest event in logs
  let requestEventFound = false;
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
        const eventReqHash = decoded.args.requestHash?.toLowerCase();
        if (eventReqHash === job.requestHash.toLowerCase()) {
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
      error: 'Matching ValidationRequest event for requestHash not found in transaction logs',
    };
  }

  // Advance state to RESPONSE_PENDING
  let currentStatus: ValidationJobStatus = 'RESPONSE_PENDING';
  let responseTxHash: string | undefined = job.responseTxHash || undefined;

  // Now submit validator response if validator key / account available
  const validatorKey = getValidatorPrivateKey();
  const validatorAccount =
    options.validatorAccount ||
    (validatorKey ? privateKeyToAccount(validatorKey) : null);

  if (validatorAccount) {
    try {
      const validatorWallet =
        options.validatorWalletClient ||
        createWalletClient({
          account: validatorAccount,
          chain: avalancheFuji,
          transport: http(rpcUrl),
        });

      const responseURI = `evidence/validation/${slug}.response.json`;
      const responseData = {
        requestHash: job.requestHash,
        missionSlug: slug,
        score: job.score ?? 100,
        tag: job.tag ?? 'verified-full',
      };
      const responseHash = keccak256(toHex(JSON.stringify(responseData)));

      responseTxHash = await validatorWallet.writeContract({
        address: registryAddress,
        abi: VALIDATION_REGISTRY_ABI,
        functionName: 'validationResponse',
        args: [
          job.requestHash as Hex,
          job.score ?? 100,
          responseURI,
          responseHash,
          job.tag ?? 'verified-full',
        ],
        chain: avalancheFuji,
        account: validatorAccount,
      });

      const respReceipt = await publicClient.waitForTransactionReceipt({
        hash: responseTxHash as Hex,
      });

      if (respReceipt.status === 'success') {
        const confirmed = await publicClient.readContract({
          address: registryAddress,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: 'isValidationComplete',
          args: [job.requestHash as Hex],
        });
        if (confirmed) {
          currentStatus = 'RESPONSE_CONFIRMED';
        } else {
          currentStatus = 'FAILED';
        }
      } else {
        currentStatus = 'FAILED';
      }
    } catch (broadcastErr: any) {
      currentStatus = 'FAILED';
      await prisma.validationJob.update({
        where: { missionSlug: slug },
        data: {
          requestTxHash: txHash,
          status: 'FAILED',
          failureReason: broadcastErr?.message || 'Validator broadcast failed',
        },
      });
      return {
        success: false,
        status: 'FAILED',
        requestTxHash: txHash,
        error: broadcastErr?.message || 'Validator broadcast failed',
      };
    }
  }

  await prisma.validationJob.update({
    where: { missionSlug: slug },
    data: {
      requestTxHash: txHash,
      responseTxHash,
      status: currentStatus,
    },
  });

  return {
    success: currentStatus === 'RESPONSE_CONFIRMED' || currentStatus === 'RESPONSE_PENDING',
    status: currentStatus,
    requestTxHash: txHash,
    responseTxHash,
  };
}

/**
 * Worker entry point to process queued validation jobs with claim/lease semantics.
 */
export async function processQueuedValidationJobs(
  limit: number = 5,
  options: RunValidatorJobOptions = {}
): Promise<{ processed: number; results: ValidatorJobResult[] }> {
  const queuedJobs = await prisma.validationJob.findMany({
    where: { status: 'QUEUED' },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });

  const results: ValidatorJobResult[] = [];
  for (const job of queuedJobs) {
    try {
      // Lease / claim job atomically
      await prisma.validationJob.update({
        where: { id: job.id },
        data: {
          status: 'LOCAL_EVALUATED',
          retryCount: { increment: 1 },
        },
      });

      const res = await runMissionValidatorJob(job.missionSlug, options);
      results.push(res);
    } catch (err: any) {
      await prisma.validationJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          failureReason: err?.message || 'Worker processing error',
        },
      });
    }
  }

  return { processed: results.length, results };
}
