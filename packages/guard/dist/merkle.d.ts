import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { PayeeDefinition } from './types.js';
export declare function normalizeAddress(addr: string): string;
export declare function isValidAddress(addr: string): boolean;
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
export declare function computePayeeMerkleTree(payees: PayeeDefinition[]): PayeeMerkleTreeResult;
export declare function getMerkleProof(payees: PayeeDefinition[], address: string): `0x${string}`[] | null;
//# sourceMappingURL=merkle.d.ts.map