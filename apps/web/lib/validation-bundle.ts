import {
  encodeAbiParameters,
  keccak256,
  getAddress,
  Hex,
  PublicClient,
  parseAbiItem,
} from 'viem';
import { computePayeeMerkleTree } from './merkle';

export interface ValidationBundle {
  version: string;
  missionId: `0x${string}`;
  missionSlug?: string;
  payeeRoot: `0x${string}`;
  auditHead: `0x${string}`;
  anchorTxHash: `0x${string}`;
  chainId: number;
  treasury: `0x${string}`;
  payees: string[];
  cap?: string;
  ownerAddress?: string;
  creationBlock?: bigint;
  snapshotBlock?: bigint;
}

export interface ValidationCheckResult {
  valid: boolean;
  score: number;
  snapshotBlock?: string;
  fromBlock?: string;
  toBlock?: string;
  checks: {
    headMatchesOnChain: boolean;
    rootMatchesOnChain: boolean;
    payeesGenerateRoot: boolean;
    executedPayeesValid: boolean;
    totalSpendWithinCap: boolean;
    hasExecutions: boolean;
  };
  tag: string;
  details: {
    onChainHead: string;
    onChainRoot: string;
    computedRoot: string;
    executedCount: number;
    totalExecutedAmount: string;
    missionCap: string;
    snapshotBlock?: string;
    fromBlock?: string;
    toBlock?: string;
    failedChecks: string[];
  };
}

const TREASURY_READ_ABI = [
  {
    type: 'function',
    name: 'anchoredMissionProofs',
    inputs: [{ name: 'missionId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'missionPayeeRoot',
    inputs: [{ name: 'missionId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'missions',
    inputs: [{ name: 'missionId', type: 'bytes32' }],
    outputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'agent', type: 'address' },
      { name: 'cap', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'exists', type: 'bool' },
      { name: 'closed', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

const EXECUTED_EVENT_ABI = parseAbiItem(
  'event Executed(uint256 indexed id, address indexed to, uint256 amount, bytes32 missionId)'
);

/**
 * Computes deterministic ERC-8004 requestHash:
 * requestHash = keccak256(abi.encode("MissionPay-validation-v1", missionId, payeeRoot, auditHead, anchorTxHash, chainId, treasury))
 */
export function computeValidationRequestHash(bundle: ValidationBundle): `0x${string}` {
  const version = bundle.version || 'MissionPay-validation-v1';
  const encoded = encodeAbiParameters(
    [
      { type: 'string' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'address' },
    ],
    [
      version,
      bundle.missionId,
      bundle.payeeRoot,
      bundle.auditHead,
      bundle.anchorTxHash,
      BigInt(bundle.chainId),
      getAddress(bundle.treasury),
    ]
  );
  return keccak256(encoded);
}

/**
 * Independent Validator verification of bundle directly against on-chain state.
 * Reads NO application database.
 */
export async function validateBundleOnChain(
  publicClient: PublicClient,
  bundle: ValidationBundle,
  fromBlock?: bigint,
  toBlock?: bigint
): Promise<ValidationCheckResult> {
  const treasuryAddress = getAddress(bundle.treasury);

  // Snapshot block for atomic reads across all contract state
  const snapshotBlock =
    toBlock ??
    bundle.snapshotBlock ??
    (typeof publicClient.getBlockNumber === 'function'
      ? await publicClient.getBlockNumber().catch(() => 0n)
      : 0n);

  if (snapshotBlock <= 0n) {
    return {
      valid: false,
      score: 0,
      tag: 'unverified-snapshot-failed',
      checks: {
        headMatchesOnChain: false,
        rootMatchesOnChain: false,
        payeesGenerateRoot: false,
        executedPayeesValid: false,
        totalSpendWithinCap: false,
        hasExecutions: false,
      },
      details: {
        onChainHead: '0x0',
        onChainRoot: '0x0',
        computedRoot: '0x0',
        executedCount: 0,
        totalExecutedAmount: '0',
        missionCap: '0',
        failedChecks: ['SNAPSHOT_READ_FAILED'],
      },
    };
  }

  const targetEndBlock = snapshotBlock;
  const targetStartBlock = fromBlock ?? bundle.creationBlock;

  // Strict scan start integrity: missing start cannot guess or truncate history
  if (targetStartBlock === undefined || targetStartBlock === null) {
    return {
      valid: false,
      score: 0,
      snapshotBlock: snapshotBlock.toString(),
      checks: {
        headMatchesOnChain: false,
        rootMatchesOnChain: false,
        payeesGenerateRoot: false,
        executedPayeesValid: false,
        totalSpendWithinCap: false,
        hasExecutions: false,
      },
      tag: 'unverified-missing-start',
      details: {
        onChainHead: '0x0',
        onChainRoot: '0x0',
        computedRoot: '0x0',
        executedCount: 0,
        totalExecutedAmount: '0',
        missionCap: '0',
        snapshotBlock: snapshotBlock.toString(),
        failedChecks: ['TRUSTED_SCAN_START_MISSING'],
      },
    };
  }

  // Range validation: inverted range is invalid
  if (targetStartBlock > targetEndBlock) {
    return {
      valid: false,
      score: 0,
      snapshotBlock: snapshotBlock.toString(),
      fromBlock: targetStartBlock.toString(),
      toBlock: targetEndBlock.toString(),
      checks: {
        headMatchesOnChain: false,
        rootMatchesOnChain: false,
        payeesGenerateRoot: false,
        executedPayeesValid: false,
        totalSpendWithinCap: false,
        hasExecutions: false,
      },
      tag: 'invalid-range',
      details: {
        onChainHead: '0x0',
        onChainRoot: '0x0',
        computedRoot: '0x0',
        executedCount: 0,
        totalExecutedAmount: '0',
        missionCap: '0',
        snapshotBlock: snapshotBlock.toString(),
        fromBlock: targetStartBlock.toString(),
        toBlock: targetEndBlock.toString(),
        failedChecks: ['INVERTED_BLOCK_RANGE'],
      },
    };
  }

  const readOpts = { blockNumber: snapshotBlock };

  // 1. Read on-chain anchored head at snapshot block
  const onChainHead = (await publicClient.readContract({
    address: treasuryAddress,
    abi: TREASURY_READ_ABI,
    functionName: 'anchoredMissionProofs',
    args: [bundle.missionId],
    ...readOpts,
  })) as `0x${string}`;

  // 2. Read on-chain payee root at snapshot block
  const onChainRoot = (await publicClient.readContract({
    address: treasuryAddress,
    abi: TREASURY_READ_ABI,
    functionName: 'missionPayeeRoot',
    args: [bundle.missionId],
    ...readOpts,
  })) as `0x${string}`;

  // 3. Read mission parameters at snapshot block
  const missionData = (await publicClient.readContract({
    address: treasuryAddress,
    abi: TREASURY_READ_ABI,
    functionName: 'missions',
    args: [bundle.missionId],
    ...readOpts,
  })) as readonly [`0x${string}`, `0x${string}`, bigint, bigint, boolean, boolean];

  const missionCap = missionData[2];

  // Check (a): head on-chain == auditHead bundle
  const headMatchesOnChain =
    onChainHead.toLowerCase() === bundle.auditHead.toLowerCase() &&
    onChainHead !== '0x0000000000000000000000000000000000000000000000000000000000000000';

  // Check (b): root on-chain == payeeRoot bundle
  const rootMatchesOnChain =
    onChainRoot.toLowerCase() === bundle.payeeRoot.toLowerCase() &&
    onChainRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000';

  // Check (c): payee set generates the same Merkle root
  const treeResult = computePayeeMerkleTree(bundle.payees);
  const payeesGenerateRoot = treeResult.root.toLowerCase() === bundle.payeeRoot.toLowerCase();

  // 4. Query Executed events for this mission in chunks <= 90 blocks
  // Scan full range from targetStartBlock through targetEndBlock without history truncation
  const CHUNK_SIZE = 90n;
  const executedLogs: any[] = [];
  const seenLogKeys = new Set<string>();

  try {
    for (let b = targetStartBlock; b <= targetEndBlock; b += CHUNK_SIZE) {
      const end = b + CHUNK_SIZE - 1n > targetEndBlock ? targetEndBlock : b + CHUNK_SIZE - 1n;
      const logs = await publicClient.getLogs({
        address: treasuryAddress,
        event: EXECUTED_EVENT_ABI,
        fromBlock: b,
        toBlock: end,
      });
      for (const log of logs) {
        if ((log.args as any).missionId?.toLowerCase() === bundle.missionId.toLowerCase()) {
          const logKey = log.transactionHash
            ? `${log.transactionHash}-${log.logIndex ?? (log.args as any).id?.toString() ?? ''}`
            : (log.args as any).id !== undefined
            ? `id-${(log.args as any).id?.toString()}`
            : null;

          if (logKey) {
            if (!seenLogKeys.has(logKey)) {
              seenLogKeys.add(logKey);
              executedLogs.push(log);
            }
          } else {
            executedLogs.push(log);
          }
        }
      }
    }
  } catch (scanErr: any) {
    return {
      valid: false,
      score: 0,
      snapshotBlock: snapshotBlock.toString(),
      fromBlock: targetStartBlock.toString(),
      toBlock: targetEndBlock.toString(),
      checks: {
        headMatchesOnChain,
        rootMatchesOnChain,
        payeesGenerateRoot,
        executedPayeesValid: false,
        totalSpendWithinCap: false,
        hasExecutions: false,
      },
      tag: 'scan-error',
      details: {
        onChainHead,
        onChainRoot,
        computedRoot: treeResult.root,
        executedCount: 0,
        totalExecutedAmount: '0',
        missionCap: missionCap.toString(),
        snapshotBlock: snapshotBlock.toString(),
        fromBlock: targetStartBlock.toString(),
        toBlock: targetEndBlock.toString(),
        failedChecks: ['RPC_SCAN_ERROR'],
      },
    };
  }

  const normalizedBundlePayees = new Set(bundle.payees.map((p) => p.toLowerCase()));
  let totalExecutedAmount = 0n;
  let executedPayeesValid = true;

  for (const log of executedLogs) {
    const to = (log.args as any).to?.toLowerCase();
    const amount = BigInt((log.args as any).amount || 0);
    totalExecutedAmount += amount;
    if (to && !normalizedBundlePayees.has(to)) {
      executedPayeesValid = false;
    }
  }

  // Check (d): total spend <= cap
  const totalSpendWithinCap = totalExecutedAmount <= missionCap;
  // Check (e): must have at least 1 execution for verified-full
  const hasExecutions = executedLogs.length > 0;

  const checks = {
    headMatchesOnChain,
    rootMatchesOnChain,
    payeesGenerateRoot,
    executedPayeesValid,
    totalSpendWithinCap,
    hasExecutions,
  };

  const failedChecks: string[] = [];
  if (!headMatchesOnChain) failedChecks.push('HEAD_MISMATCH');
  if (!rootMatchesOnChain) failedChecks.push('ROOT_MISMATCH');
  if (!payeesGenerateRoot) failedChecks.push('PAYEE_TREE_MISMATCH');
  if (!hasExecutions) failedChecks.push('NO_EXECUTIONS_FOUND');
  if (!executedPayeesValid) failedChecks.push('EXECUTED_PAYEE_UNAUTHORIZED');
  if (!totalSpendWithinCap) failedChecks.push('SPEND_EXCEEDS_CAP');

  const valid = failedChecks.length === 0;
  const score = valid ? 100 : 0;
  const tag = valid ? 'verified-full' : `failed:${failedChecks.join(',')}`;

  return {
    valid,
    score,
    snapshotBlock: snapshotBlock.toString(),
    fromBlock: targetStartBlock.toString(),
    toBlock: targetEndBlock.toString(),
    checks,
    tag,
    details: {
      onChainHead,
      onChainRoot,
      computedRoot: treeResult.root,
      executedCount: executedLogs.length,
      totalExecutedAmount: totalExecutedAmount.toString(),
      missionCap: missionCap.toString(),
      snapshotBlock: snapshotBlock.toString(),
      fromBlock: targetStartBlock.toString(),
      toBlock: targetEndBlock.toString(),
      failedChecks,
    },
  };
}
