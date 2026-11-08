import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { getAddress } from 'viem';
import { PayeeDefinition } from './types.js';

export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  return addr.trim().toLowerCase();
}

export function isValidAddress(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  try {
    getAddress(addr);
    return true;
  } catch {
    return false;
  }
}

export interface PayeeMerkleTreeResult {
  root: `0x${string}`;
  payees: string[];
  tree: StandardMerkleTree<[string]>;
  getProof: (address: string) => `0x${string}`[] | null;
}

/**
 * Computes an OpenZeppelin StandardMerkleTree over recipient addresses.
 * Leaf double-hash standard strictly matches GuardedTreasury.sol:
 * keccak256(bytes.concat(keccak256(abi.encode(to))))
 */
export function computePayeeMerkleTree(payees: PayeeDefinition[]): PayeeMerkleTreeResult {
  const normalizedSet = new Set<string>();
  for (const p of payees) {
    const rawAddr = typeof p === 'string' ? p : p?.address;
    if (rawAddr && typeof rawAddr === 'string') {
      try {
        normalizedSet.add(normalizeAddress(rawAddr));
      } catch {}
    }
  }

  const normalized = Array.from(normalizedSet);

  if (normalized.length === 0) {
    const emptyRoot = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
    return {
      root: emptyRoot,
      payees: [],
      tree: null as any,
      getProof: () => null,
    };
  }

  // Double-hashed leaves matching StandardMerkleTree.of(..., ["address"])
  const values: [string][] = normalized.map((addr) => [addr]);
  const tree = StandardMerkleTree.of(values, ['address']);
  const root = tree.root as `0x${string}`;

  return {
    root,
    payees: normalized,
    tree,
    getProof: (address: string) => {
      try {
        const nor = normalizeAddress(address);
        return tree.getProof([nor]) as `0x${string}`[];
      } catch {
        return null;
      }
    },
  };
}

export function getMerkleProof(payees: PayeeDefinition[], address: string): `0x${string}`[] | null {
  const treeRes = computePayeeMerkleTree(payees);
  return treeRes.getProof(address);
}
