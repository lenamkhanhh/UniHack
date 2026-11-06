import { keccak256, stringToBytes } from 'viem';
import { normalizeAddress } from './chain';
import { getPaymentMode } from './config';

/**
 * ERC-8004 Trustless Agent Identity & Reputation Client (STRATEGY §4.4)
 * Addresses pinned on Avalanche Fuji Testnet (erc-8004/erc-8004-contracts):
 * - IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 * - ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 */

export const ERC8004_FUJI_IDENTITY_REGISTRY =
  '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const;

export const ERC8004_FUJI_REPUTATION_REGISTRY =
  '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const;

// Pinned ABI for ERC-8004 Registry interactions
export const ERC8004_IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [{ name: 'tokenUri', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAgent',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'tokenUri', type: 'string' },
    ],
    stateMutability: 'view',
  },
] as const;

export const ERC8004_REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getReputation',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [
      { name: 'score', type: 'int128' },
      { name: 'count', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

export interface Erc8004FeedbackParams {
  sellerAddress: string;
  operationId: string;
  operationState: string;
  ownerConfirmed: boolean;
  score?: number; // default: 87 (starred)
  tag?: string; // default: 'starred'
}

export interface Erc8004FeedbackResult {
  success: boolean;
  mode: 'MOCK' | 'LIVE_FUJI';
  agent: string;
  score: number;
  valueDecimals: number;
  tag: string;
  registryAddress: string;
  txHash?: string;
  simulated?: boolean;
  error?: string;
}

/**
 * Submits ERC-8004 feedback for a tool seller.
 * Strictly enforced invariants:
 * 1. Operation must be SETTLED (never submit feedback for unverified/failed ops)
 * 2. Owner must have confirmed the deliverable
 */
export async function submitErc8004Feedback(
  params: Erc8004FeedbackParams
): Promise<Erc8004FeedbackResult> {
  const seller = normalizeAddress(params.sellerAddress);

  if (params.operationState !== 'SETTLED') {
    return {
      success: false,
      mode: getPaymentMode() as 'MOCK' | 'LIVE_FUJI',
      agent: seller,
      score: 0,
      valueDecimals: 0,
      tag: params.tag || 'starred',
      registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
      error: `Cannot give feedback: operation is ${params.operationState}, must be SETTLED`,
    };
  }

  if (!params.ownerConfirmed) {
    return {
      success: false,
      mode: getPaymentMode() as 'MOCK' | 'LIVE_FUJI',
      agent: seller,
      score: 0,
      valueDecimals: 0,
      tag: params.tag || 'starred',
      registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
      error: 'Cannot give feedback: owner confirmation required',
    };
  }

  const score = params.score !== undefined ? params.score : 87;
  const tag = params.tag || 'starred';
  const mode = getPaymentMode() as 'MOCK' | 'LIVE_FUJI';

  if (mode === 'MOCK') {
    const simulatedTxHash = keccak256(
      stringToBytes(`erc8004:feedback:${params.operationId}:${seller}:${score}`)
    );
    return {
      success: true,
      mode: 'MOCK',
      agent: seller,
      score,
      valueDecimals: 0,
      tag,
      registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
      txHash: simulatedTxHash,
      simulated: true,
    };
  }

  // LIVE_FUJI mode: returns ready execution parameters
  return {
    success: true,
    mode: 'LIVE_FUJI',
    agent: seller,
    score,
    valueDecimals: 0,
    tag,
    registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
    simulated: false,
  };
}
