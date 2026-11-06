import { encodeFunctionData, toFunctionSelector } from 'viem';
import { getPaymentMode } from './config';
import reputationJson from './abi/erc8004-reputation.json';
import identityJson from './abi/erc8004-identity.json';

/**
 * ERC-8004 Trustless Agent Identity & Reputation Client (STRATEGY §4.4 & ERC-01/02)
 *
 * Pinned on Avalanche Fuji Testnet (erc-8004/erc-8004-contracts):
 * - IdentityRegistry Proxy: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   Implementation: 0x7274e874CA62410a93Bd8bf61c69d8045E399c02
 * - ReputationRegistry Proxy: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 *   Implementation: 0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34
 */

export const ERC8004_FUJI_IDENTITY_REGISTRY =
  identityJson.proxyAddress as `0x${string}`;

export const ERC8004_FUJI_REPUTATION_REGISTRY =
  reputationJson.proxyAddress as `0x${string}`;

export const ERC8004_REPUTATION_ABI = [
  {
    type: 'function',
    name: 'giveFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getSummary',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'readFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddress', type: 'address' },
      { name: 'feedbackIndex', type: 'uint64' },
    ],
    outputs: [
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'isRevoked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

export const ERC8004_IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'register',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const;

export interface Erc8004FeedbackParams {
  agentId: bigint | number; // ERC-721 tokenId of agent/seller on IdentityRegistry
  operationId: string;
  operationState: string;
  ownerConfirmed: boolean;
  score?: number; // e.g. 87 (starred)
  tag1?: string; // e.g. 'starred'
  tag2?: string; // e.g. 'unihack-s2'
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: `0x${string}`;
  txHash?: string | null;
}

export interface Erc8004FeedbackResult {
  success: boolean;
  mode: 'MOCK' | 'LIVE_FUJI';
  agentId: string;
  score: number;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  registryAddress: string;
  calldata?: `0x${string}`;
  txHash: string | null;
  simulated: boolean;
  error?: string;
}

/**
 * Submits ERC-8004 feedback for a tool seller agent.
 * Invariants:
 * 1. Operation must be SETTLED.
 * 2. Mission owner must have confirmed the deliverable.
 * 3. ERC-02: MOCK returns txHash: null (never generates fake hashes).
 */
export async function submitErc8004Feedback(
  params: Erc8004FeedbackParams
): Promise<Erc8004FeedbackResult> {
  const agentIdBigInt = BigInt(params.agentId);
  const score = params.score !== undefined ? params.score : 87;
  const tag1 = params.tag1 || 'starred';
  const tag2 = params.tag2 || 'unihack-s2';
  const endpoint = params.endpoint || 'https://unihack.app';
  const feedbackURI = params.feedbackURI || 'ipfs://unihack-feedback-s2';
  const feedbackHash =
    params.feedbackHash ||
    ('0x0000000000000000000000000000000000000000000000000000000000000000' as const);

  if (params.operationState !== 'SETTLED') {
    return {
      success: false,
      mode: getPaymentMode() as 'MOCK' | 'LIVE_FUJI',
      agentId: agentIdBigInt.toString(),
      score: 0,
      valueDecimals: 0,
      tag1,
      tag2,
      registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
      txHash: null,
      simulated: false,
      error: `Cannot give feedback: operation is ${params.operationState}, must be SETTLED`,
    };
  }

  if (!params.ownerConfirmed) {
    return {
      success: false,
      mode: getPaymentMode() as 'MOCK' | 'LIVE_FUJI',
      agentId: agentIdBigInt.toString(),
      score: 0,
      valueDecimals: 0,
      tag1,
      tag2,
      registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
      txHash: null,
      simulated: false,
      error: 'Cannot give feedback: owner confirmation required',
    };
  }

  // Encode call with verified 8-parameter ABI
  const calldata = encodeFunctionData({
    abi: ERC8004_REPUTATION_ABI,
    functionName: 'giveFeedback',
    args: [
      agentIdBigInt,
      BigInt(score),
      0, // valueDecimals = 0
      tag1,
      tag2,
      endpoint,
      feedbackURI,
      feedbackHash,
    ],
  });

  const mode = getPaymentMode() as 'MOCK' | 'LIVE_FUJI';

  // ERC-02: In MOCK mode, strictly return txHash: null (honest reporting)
  return {
    success: true,
    mode,
    agentId: agentIdBigInt.toString(),
    score,
    valueDecimals: 0,
    tag1,
    tag2,
    registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
    calldata,
    txHash: null,
    simulated: mode === 'MOCK',
  };
}
