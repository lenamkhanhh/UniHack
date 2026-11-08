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

// In-memory registry cache to record validation status for tests and offline operations
export interface InMemoryValidationRecord {
  requestHash: `0x${string}`;
  validatorAddress: string;
  agentId: string;
  score: number;
  responseHash: string;
  tag: string;
  lastUpdate: number;
  isComplete: boolean;
  txHash?: string;
  bundle?: ValidationBundle;
  details?: any;
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
  const latestEntry = await prisma.auditEntry.findFirst({
    where: { missionSlug: slug },
    orderBy: { missionSequence: 'desc' },
  });

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
  isRegisteredOnChain: boolean;
  requestTxHash?: string;
  responseTxHash?: string;
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
  try {
    validationResult = await validateBundleOnChain(
      publicClient,
      bundle,
      options.fromBlock,
      options.toBlock
    );
  } catch (err: any) {
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

  const validatorKey = getValidatorPrivateKey();
  const validatorAccount =
    options.validatorAccount ||
    (validatorKey ? privateKeyToAccount(validatorKey) : null);
  const validatorAddress =
    validatorAccount?.address ||
    process.env.VALIDATOR_ADDRESS ||
    '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5';

  // 3. Optional On-Chain Submission if enabled and not skipped
  if (!options.skipOnChainBroadcast && validatorAccount) {
    try {
      const validatorWallet =
        options.validatorWalletClient ||
        createWalletClient({
          account: validatorAccount,
          chain: avalancheFuji,
          transport: http(rpcUrl),
        });

      // Ensure request exists on-chain; submit validationRequest from requester if needed
      let requestExists = false;
      try {
        const currentStatus = (await publicClient.readContract({
          address: registryAddress,
          abi: VALIDATION_REGISTRY_ABI,
          functionName: 'getValidationStatus',
          args: [requestHash],
        })) as readonly [string, bigint, number, string, string, bigint];
        requestExists = currentStatus[5] > 0n;
      } catch {
        // getValidationStatus reverts on ValidationRegistry if request doesn't exist
        requestExists = false;
      }

      if (!requestExists && options.ownerWalletClient && options.ownerWalletClient.account) {
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
          await publicClient.waitForTransactionReceipt({ hash: requestTxHash as `0x${string}` });
        } catch (reqErr: any) {
          console.warn('[ValidationRequest Broadcast Error]', reqErr?.message || reqErr);
        }
      }

      // Submit response on-chain
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
      await publicClient.waitForTransactionReceipt({ hash: responseTxHash as `0x${string}` });
      isRegisteredOnChain = true;
    } catch (broadcastErr: any) {
      console.warn('[Validator On-Chain Broadcast Error]', broadcastErr?.message || broadcastErr);
    }
  }

  // 4. Update memory cache and write evidence file if directory exists
  const memRecord: InMemoryValidationRecord = {
    requestHash,
    validatorAddress,
    agentId: agentId.toString(),
    score: validationResult.score,
    responseHash,
    tag: validationResult.tag,
    lastUpdate: Math.floor(Date.now() / 1000),
    isComplete: true,
    txHash: responseTxHash,
    bundle,
    details: validationResult.details,
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
    isRegisteredOnChain,
    requestTxHash,
    responseTxHash,
  };
}
