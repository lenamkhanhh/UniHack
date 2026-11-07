import { createPublicClient, http, parseAbiItem, decodeEventLog } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { normalizeAddress } from './chain';

const DEFAULT_RPC_URL = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
const REPUTATION_REGISTRY_ADDRESS = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

export const missionFundedEventAbi = parseAbiItem(
  'event MissionFunded(bytes32 indexed missionId, address indexed wallet, uint256 amount)'
);

export const missionProofAnchoredEventAbi = parseAbiItem(
  'event MissionProofAnchored(bytes32 indexed missionId, bytes32 indexed headHash, uint256 timestamp)'
);

export const missionPayeeRootSetEventAbi = parseAbiItem(
  'event MissionPayeeRootSet(bytes32 indexed missionId, bytes32 indexed root, uint256 policyVersion)'
);

export const feedbackGivenEventAbi = parseAbiItem(
  'event FeedbackGiven(uint256 indexed agentId, address indexed client, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string tag1, string tag2)'
);

export interface ReceiptVerificationResult {
  valid: boolean;
  error?: string;
  blockNumber?: bigint;
  txHash?: string;
}

export type ReceiptFetcher = (txHash: string) => Promise<any>;
let customReceiptFetcher: ReceiptFetcher | null = null;

export function setReceiptFetcherForTesting(fetcher: ReceiptFetcher | null) {
  customReceiptFetcher = fetcher;
}

async function getReceipt(txHash: string, rpcUrl: string = DEFAULT_RPC_URL): Promise<any> {
  if (customReceiptFetcher) {
    return await customReceiptFetcher(txHash);
  }

  const client = createPublicClient({
    chain: avalancheFuji,
    transport: http(rpcUrl),
  });

  return await client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);
}

function normalizeBytes32(val: string): string {
  const clean = val.startsWith('0x') ? val.toLowerCase() : `0x${val.toLowerCase()}`;
  return clean.padEnd(66, '0');
}

/**
 * WIRE-01: Verifies on-chain MissionFunded event on Avalanche Fuji.
 * Rejects if tx reverted, contract mismatch, missionId mismatch, wallet mismatch, or amount < expected.
 */
export async function verifyFundingReceiptOnFuji(params: {
  txHash: string;
  missionId: string;
  sessionWallet: string;
  expectedAmount: bigint;
  treasuryAddress: string;
}): Promise<ReceiptVerificationResult> {
  if (!params.treasuryAddress || params.treasuryAddress === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Valid non-zero treasuryAddress is required for verification' };
  }

  const receipt = await getReceipt(params.txHash);
  if (!receipt) {
    return { valid: false, error: 'Transaction receipt not found on Avalanche Fuji' };
  }

  if (receipt.status !== 'success') {
    return { valid: false, error: 'Transaction reverted on-chain' };
  }

  if (receipt.to) {
    if (normalizeAddress(receipt.to) !== normalizeAddress(params.treasuryAddress)) {
      return {
        valid: false,
        error: `Transaction recipient mismatch: expected ${params.treasuryAddress}, got ${receipt.to}`,
      };
    }
  }

  const expectedMissionId = normalizeBytes32(params.missionId);
  const expectedWallet = normalizeAddress(params.sessionWallet);
  const expectedTreasury = normalizeAddress(params.treasuryAddress);

  let foundFundedEvent = false;

  for (const log of receipt.logs || []) {
    // RCPT-01: log.address MUST match treasury contract! Ignore logs from other contracts
    if (!log.address || normalizeAddress(log.address) !== expectedTreasury) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: [missionFundedEventAbi],
        data: log.data,
        topics: log.topics,
      }) as any;

      if (decoded.eventName === 'MissionFunded') {
        const eventMissionId = normalizeBytes32(decoded.args.missionId);
        const eventWallet = normalizeAddress(decoded.args.wallet);
        const eventAmount = BigInt(decoded.args.amount.toString());

        if (eventMissionId !== expectedMissionId) {
          return {
            valid: false,
            error: `MissionFunded missionId mismatch: expected ${expectedMissionId}, got ${eventMissionId}`,
          };
        }

        if (eventWallet !== expectedWallet) {
          return {
            valid: false,
            error: `MissionFunded wallet mismatch: expected ${expectedWallet}, got ${eventWallet}`,
          };
        }

        if (eventAmount < params.expectedAmount) {
          return {
            valid: false,
            error: `MissionFunded amount insufficient: expected >= ${params.expectedAmount}, got ${eventAmount}`,
          };
        }

        foundFundedEvent = true;
        break;
      }
    } catch {
      // Not a MissionFunded log, continue
    }
  }

  if (!foundFundedEvent) {
    return { valid: false, error: 'MissionFunded event not found from expected treasury contract' };
  }

  return {
    valid: true,
    blockNumber: receipt.blockNumber ? BigInt(receipt.blockNumber.toString()) : undefined,
    txHash: params.txHash,
  };
}

/**
 * WIRE-01: Verifies on-chain MissionProofAnchored event on Avalanche Fuji.
 * Rejects if tx reverted, contract mismatch, missionId mismatch, or headHash mismatch.
 */
export async function verifyAnchorReceiptOnFuji(params: {
  txHash: string;
  missionId: string;
  expectedHeadHash: string;
  treasuryAddress: string;
}): Promise<ReceiptVerificationResult> {
  if (!params.treasuryAddress || params.treasuryAddress === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Valid non-zero treasuryAddress is required for verification' };
  }

  const receipt = await getReceipt(params.txHash);
  if (!receipt) {
    return { valid: false, error: 'Transaction receipt not found on Avalanche Fuji' };
  }

  if (receipt.status !== 'success') {
    return { valid: false, error: 'Transaction reverted on-chain' };
  }

  if (receipt.to) {
    if (normalizeAddress(receipt.to) !== normalizeAddress(params.treasuryAddress)) {
      return {
        valid: false,
        error: `Transaction recipient mismatch: expected ${params.treasuryAddress}, got ${receipt.to}`,
      };
    }
  }

  const expectedMissionId = normalizeBytes32(params.missionId);
  const expectedHeadHash = normalizeBytes32(params.expectedHeadHash);
  const expectedTreasury = normalizeAddress(params.treasuryAddress);

  let foundAnchorEvent = false;

  for (const log of receipt.logs || []) {
    // RCPT-01: log.address MUST match treasury contract! Ignore logs from other contracts
    if (!log.address || normalizeAddress(log.address) !== expectedTreasury) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: [missionProofAnchoredEventAbi],
        data: log.data,
        topics: log.topics,
      }) as any;

      if (decoded.eventName === 'MissionProofAnchored') {
        const eventMissionId = normalizeBytes32(decoded.args.missionId);
        const eventHeadHash = normalizeBytes32(decoded.args.headHash);

        if (eventMissionId !== expectedMissionId) {
          return {
            valid: false,
            error: `MissionProofAnchored missionId mismatch: expected ${expectedMissionId}, got ${eventMissionId}`,
          };
        }

        if (eventHeadHash !== expectedHeadHash) {
          return {
            valid: false,
            error: `MissionProofAnchored headHash mismatch: expected ${expectedHeadHash}, got ${eventHeadHash}`,
          };
        }

        foundAnchorEvent = true;
        break;
      }
    } catch {
      // Not a MissionProofAnchored log, continue
    }
  }

  if (!foundAnchorEvent) {
    return { valid: false, error: 'MissionProofAnchored event not found from expected treasury contract' };
  }

  return {
    valid: true,
    blockNumber: receipt.blockNumber ? BigInt(receipt.blockNumber.toString()) : undefined,
    txHash: params.txHash,
  };
}

/**
 * PV-3: Verifies on-chain MissionPayeeRootSet event on Avalanche Fuji.
 * Rejects if tx reverted, contract mismatch, missionId mismatch, or root mismatch.
 */
export async function verifyPayeeRootReceiptOnFuji(params: {
  txHash: string;
  missionId: string;
  expectedRoot: string;
  treasuryAddress: string;
}): Promise<ReceiptVerificationResult & { policyVersion?: bigint }> {
  if (!params.treasuryAddress || params.treasuryAddress === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Valid non-zero treasuryAddress is required for verification' };
  }

  const receipt = await getReceipt(params.txHash);
  if (!receipt) {
    return { valid: false, error: 'Transaction receipt not found on Avalanche Fuji' };
  }

  if (receipt.status !== 'success') {
    return { valid: false, error: 'Transaction reverted on-chain' };
  }

  const expectedTreasury = normalizeAddress(params.treasuryAddress);
  if (receipt.to && normalizeAddress(receipt.to) !== expectedTreasury) {
    return {
      valid: false,
      error: `Transaction recipient mismatch: expected ${expectedTreasury}, got ${receipt.to}`,
    };
  }

  const expectedMissionId = normalizeBytes32(params.missionId);
  const expectedRoot = normalizeBytes32(params.expectedRoot);

  let foundRootEvent = false;
  let policyVersion: bigint | undefined = undefined;

  for (const log of receipt.logs || []) {
    if (!log.address || normalizeAddress(log.address) !== expectedTreasury) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: [missionPayeeRootSetEventAbi],
        data: log.data,
        topics: log.topics,
      }) as any;

      if (decoded.eventName === 'MissionPayeeRootSet') {
        const eventMissionId = normalizeBytes32(decoded.args.missionId);
        const eventRoot = normalizeBytes32(decoded.args.root);

        if (eventMissionId !== expectedMissionId) {
          return {
            valid: false,
            error: `MissionPayeeRootSet missionId mismatch: expected ${expectedMissionId}, got ${eventMissionId}`,
          };
        }

        if (eventRoot !== expectedRoot) {
          return {
            valid: false,
            error: `MissionPayeeRootSet root mismatch: expected ${expectedRoot}, got ${eventRoot}`,
          };
        }

        policyVersion = BigInt(decoded.args.policyVersion.toString());
        foundRootEvent = true;
        break;
      }
    } catch {
      // Continue searching
    }
  }

  if (!foundRootEvent) {
    return { valid: false, error: 'MissionPayeeRootSet event not found from expected treasury contract' };
  }

  return {
    valid: true,
    policyVersion,
    blockNumber: receipt.blockNumber ? BigInt(receipt.blockNumber.toString()) : undefined,
    txHash: params.txHash,
  };
}

/**
 * FB-01 & RCPT-01: Verifies on-chain feedback transaction on Avalanche Fuji Reputation Registry.
 * Rejects if tx reverted, recipient mismatch, log address mismatch, or agentId mismatch.
 */
export async function verifyFeedbackReceiptOnFuji(params: {
  txHash: string;
  expectedAgentId: bigint;
  registryAddress?: string;
}): Promise<ReceiptVerificationResult> {
  const receipt = await getReceipt(params.txHash);
  if (!receipt) {
    return { valid: false, error: 'Transaction receipt not found on Avalanche Fuji' };
  }

  if (receipt.status !== 'success') {
    return { valid: false, error: 'Transaction reverted on-chain' };
  }

  const expectedRegistry = normalizeAddress(params.registryAddress || REPUTATION_REGISTRY_ADDRESS);
  if (receipt.to && normalizeAddress(receipt.to) !== expectedRegistry) {
    return {
      valid: false,
      error: `Transaction recipient mismatch: expected ${expectedRegistry}, got ${receipt.to}`,
    };
  }

  let foundFeedbackEvent = false;

  // Check for FeedbackGiven event if present in logs
  for (const log of receipt.logs || []) {
    // RCPT-01: Log MUST be emitted by the ReputationRegistry contract!
    if (!log.address || normalizeAddress(log.address) !== expectedRegistry) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: [feedbackGivenEventAbi],
        data: log.data,
        topics: log.topics,
      }) as any;

      if (decoded.eventName === 'FeedbackGiven') {
        const loggedAgentId = BigInt(decoded.args.agentId.toString());
        if (loggedAgentId !== params.expectedAgentId) {
          return {
            valid: false,
            error: `FeedbackGiven agentId mismatch: expected ${params.expectedAgentId}, got ${loggedAgentId}`,
          };
        }
        foundFeedbackEvent = true;
        break;
      }
    } catch {
      // continue
    }
  }

  if (!foundFeedbackEvent) {
    return { valid: false, error: 'FeedbackGiven event not found from expected ReputationRegistry contract' };
  }

  return {
    valid: true,
    blockNumber: receipt.blockNumber ? BigInt(receipt.blockNumber.toString()) : undefined,
    txHash: params.txHash,
  };
}
