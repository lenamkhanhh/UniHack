"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAddress = normalizeAddress;
exports.isValidAddress = isValidAddress;
exports.computePayeeMerkleTree = computePayeeMerkleTree;
exports.getMerkleProof = getMerkleProof;
const merkle_tree_1 = require("@openzeppelin/merkle-tree");
const viem_1 = require("viem");
function normalizeAddress(addr) {
    if (!addr)
        return '';
    return addr.trim().toLowerCase();
}
function isValidAddress(addr) {
    if (!addr || typeof addr !== 'string')
        return false;
    try {
        (0, viem_1.getAddress)(addr);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Computes an OpenZeppelin StandardMerkleTree over recipient addresses.
 * Leaf double-hash standard strictly matches GuardedTreasury.sol:
 * keccak256(bytes.concat(keccak256(abi.encode(to))))
 */
function computePayeeMerkleTree(payees) {
    const normalizedSet = new Set();
    for (const p of payees) {
        const rawAddr = typeof p === 'string' ? p : p?.address;
        if (rawAddr && typeof rawAddr === 'string') {
            try {
                normalizedSet.add(normalizeAddress(rawAddr));
            }
            catch { }
        }
    }
    const normalized = Array.from(normalizedSet);
    if (normalized.length === 0) {
        const emptyRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';
        return {
            root: emptyRoot,
            payees: [],
            tree: null,
            getProof: () => null,
        };
    }
    // Double-hashed leaves matching StandardMerkleTree.of(..., ["address"])
    const values = normalized.map((addr) => [addr]);
    const tree = merkle_tree_1.StandardMerkleTree.of(values, ['address']);
    const root = tree.root;
    return {
        root,
        payees: normalized,
        tree,
        getProof: (address) => {
            try {
                const nor = normalizeAddress(address);
                return tree.getProof([nor]);
            }
            catch {
                return null;
            }
        },
    };
}
function getMerkleProof(payees, address) {
    const treeRes = computePayeeMerkleTree(payees);
    return treeRes.getProof(address);
}
//# sourceMappingURL=merkle.js.map