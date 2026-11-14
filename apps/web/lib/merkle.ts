import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { encodeFunctionData, parseAbiItem } from 'viem';
import { normalizeAddress } from './chain';
import {
  computePayeeMerkleTree,
  getMerkleProof,
  PayeeMerkleTreeResult,
  PayeeDefinition,
} from '@missionpay/guard';

export { computePayeeMerkleTree, getMerkleProof };
export type { PayeeMerkleTreeResult };
export type PayeeInput = PayeeDefinition;

export const setMissionPayeeRootAbi = parseAbiItem(
  'function setMissionPayeeRoot(bytes32 missionId, bytes32 root) external'
);

export const proposeWithProofAbi = parseAbiItem(
  'function proposeWithProof(bytes32 operationId, address to, uint256 amount, bytes32 missionId, string reason, bytes32[] proof) external returns (uint256)'
);

// In-memory store of mission payee sets
interface MissionPayeeRecord {
  missionSlug: string;
  payees: string[];
  treeResult: PayeeMerkleTreeResult;
  updatedAt: Date;
}

const missionPayeeStore = new Map<string, MissionPayeeRecord>();

export function saveMissionPayees(missionSlug: string, payees: string[]): PayeeMerkleTreeResult {
  const treeResult = computePayeeMerkleTree(payees);
  missionPayeeStore.set(missionSlug, {
    missionSlug,
    payees: treeResult.payees,
    treeResult,
    updatedAt: new Date(),
  });
  return treeResult;
}

export function getMissionPayees(missionSlug: string): string[] | undefined {
  return missionPayeeStore.get(missionSlug)?.payees;
}

export function getMissionPayeeTree(missionSlug: string): PayeeMerkleTreeResult | undefined {
  return missionPayeeStore.get(missionSlug)?.treeResult;
}

export function getMissionPayeeProof(
  missionSlug: string,
  address: string,
  fallbackPayees?: string[]
): `0x${string}`[] | null {
  let record = missionPayeeStore.get(missionSlug);
  if (!record && fallbackPayees && fallbackPayees.length > 0) {
    const treeResult = computePayeeMerkleTree(fallbackPayees);
    record = {
      missionSlug,
      payees: treeResult.payees,
      treeResult,
      updatedAt: new Date(),
    };
    missionPayeeStore.set(missionSlug, record);
  }
  if (!record) return null;
  return record.treeResult.getProof(address);
}

export function clearMissionPayeesForTesting(): void {
  missionPayeeStore.clear();
}

/**
 * Builds calldata for GuardedTreasury.setMissionPayeeRoot(bytes32 missionId, bytes32 root)
 */
export function buildSetMissionPayeeRootCalldata(missionId: string, root: string): `0x${string}` {
  const cleanMissionId = (missionId.startsWith('0x') ? missionId : `0x${missionId}`).padEnd(66, '0') as `0x${string}`;
  const cleanRoot = (root.startsWith('0x') ? root : `0x${root}`).padEnd(66, '0') as `0x${string}`;
  return encodeFunctionData({
    abi: [setMissionPayeeRootAbi],
    functionName: 'setMissionPayeeRoot',
    args: [cleanMissionId, cleanRoot],
  });
}

/**
 * Builds calldata for GuardedTreasury.proposeWithProof(...)
 */
export function buildProposeWithProofCalldata(params: {
  operationId: string;
  to: string;
  amountAtomic: bigint;
  missionId: string;
  reason: string;
  proof: `0x${string}`[];
}): `0x${string}` {
  const rawOpId = params.operationId.replace(/-/g, '');
  const cleanOpId = (rawOpId.startsWith('0x') ? rawOpId : `0x${rawOpId}`).padEnd(66, '0') as `0x${string}`;
  const cleanMissionId = (params.missionId.startsWith('0x') ? params.missionId : `0x${params.missionId}`).padEnd(66, '0') as `0x${string}`;
  return encodeFunctionData({
    abi: [proposeWithProofAbi],
    functionName: 'proposeWithProof',
    args: [
      cleanOpId,
      normalizeAddress(params.to) as `0x${string}`,
      params.amountAtomic,
      cleanMissionId,
      params.reason,
      params.proof,
    ],
  });
}
