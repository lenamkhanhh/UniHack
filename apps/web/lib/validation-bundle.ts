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
}

export interface ValidationCheckResult {
  valid: boolean;
  score: number;
  checks: {
    headMatchesOnChain: boolean;
    rootMatchesOnChain: boolean;
    payeesGenerateRoot: boolean;
    executedPayeesValid: boolean;
    totalSpendWithinCap: boolean;
  };
  tag: string;
  details: {
    onChainHead: string;
    onChainRoot: string;
    computedRoot: string;
    executedCount: number;
    totalExecutedAmount: string;
    missionCap: string;
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
  'event Executed(uint256 indexed proposalId, bytes32 indexed missionId, address indexed to, uint256 amount)'
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
  fromBlock: bigint = 60689760n,
  toBlock: bigint = 60689770n
): Promise<ValidationCheckResult> {
  const treasuryAddress = getAddress(bundle.treasury);

  // 1. Read on-chain anchored head
  const onChainHead = (await publicClient.readContract({
    address: treasuryAddress,
    abi: TREASURY_READ_ABI,
    functionName: 'anchoredMissionProofs',
    args: [bundle.missionId],
  })) as `0x${string}`;

  // 2. Read on-chain payee root
  const onChainRoot = (await publicClient.readContract({
    address: treasuryAddress,
    abi: TREASURY_READ_ABI,
    functionName: 'missionPayeeRoot',
    args: [bundle.missionId],
  })) as `0x${string}`;

  // 3. Read mission parameters
  const missionData = (await publicClient.readContract({
    address: treasuryAddress,
    abi: TREASURY_READ_ABI,
    functionName: 'missions',
    args: [bundle.missionId],
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

  // 4. Query Executed events for this mission within a valid block range
  const executedLogs = await publicClient.getLogs({
    address: treasuryAddress,
    event: EXECUTED_EVENT_ABI,
    args: {
      missionId: bundle.missionId,
    },
    fromBlock,
    toBlock,
  });

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

  const checks = {
    headMatchesOnChain,
    rootMatchesOnChain,
    payeesGenerateRoot,
    executedPayeesValid,
    totalSpendWithinCap,
  };

  const failedChecks: string[] = [];
  if (!headMatchesOnChain) failedChecks.push('HEAD_MISMATCH');
  if (!rootMatchesOnChain) failedChecks.push('ROOT_MISMATCH');
  if (!payeesGenerateRoot) failedChecks.push('PAYEE_TREE_MISMATCH');
  if (!executedPayeesValid) failedChecks.push('EXECUTED_PAYEE_UNAUTHORIZED');
  if (!totalSpendWithinCap) failedChecks.push('SPEND_EXCEEDS_CAP');

  const valid = failedChecks.length === 0;
  const score = valid ? 100 : 0;
  const tag = valid ? 'verified-full' : `failed:${failedChecks.join(',')}`;

  return {
    valid,
    score,
    checks,
    tag,
    details: {
      onChainHead,
      onChainRoot,
      computedRoot: treeResult.root,
      executedCount: executedLogs.length,
      totalExecutedAmount: totalExecutedAmount.toString(),
      missionCap: missionCap.toString(),
      failedChecks,
    },
  };
}
