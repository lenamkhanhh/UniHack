import re
from typing import List, Tuple, Callable, Optional, Set
from eth_abi import encode
from web3 import Web3

def iban_to_evm_address(iban: str) -> str:
    cleaned = iban.strip().upper()
    h = Web3.keccak(text=cleaned).hex()
    return Web3.to_checksum_address("0x" + h[-40:])

def get_leaf(address: str) -> bytes:
    # Double-hashed leaf standard matching OpenZeppelin StandardMerkleTree.of(..., ["address"])
    # keccak256(bytes.concat(keccak256(abi.encode(to))))
    inner = Web3.keccak(encode(["address"], [Web3.to_checksum_address(address)]))
    return Web3.keccak(inner)

def hash_pair(a: bytes, b: bytes) -> bytes:
    return Web3.keccak(a + b if a < b else b + a)

class StandardMerkleTree:
    def __init__(self, addresses: List[str]):
        # Deduplicate and sort addresses
        norm_set: Set[str] = set()
        for a in addresses:
            if a:
                try:
                    norm_set.add(Web3.to_checksum_address(a))
                except Exception:
                    pass
        sorted_addresses = sorted(list(norm_set))
        self.addresses = sorted_addresses

        if not sorted_addresses:
            self.root = bytes(32)
            self.leaves = []
            return

        # Double hashed leaves
        self.leaves = [get_leaf(a) for a in sorted_addresses]
        
        # Build tree levels
        levels: List[List[bytes]] = [self.leaves]
        current = self.leaves
        while len(current) > 1:
            next_level: List[bytes] = []
            for i in range(0, len(current), 2):
                if i + 1 < len(current):
                    next_level.append(hash_pair(current[i], current[i + 1]))
                else:
                    next_level.append(current[i])
            levels.append(next_level)
            current = next_level

        self.levels = levels
        self.root = current[0] if current else bytes(32)

    def get_proof(self, address: str) -> Optional[List[bytes]]:
        try:
            target = Web3.to_checksum_address(address)
        except Exception:
            return None
        if target not in self.addresses:
            return None

        idx = self.addresses.index(target)
        proof: List[bytes] = []
        for level in self.levels[:-1]:
            is_right_node = idx % 2 == 1
            sibling_idx = idx - 1 if is_right_node else idx + 1
            if sibling_idx < len(level):
                proof.append(level[sibling_idx])
            idx //= 2
        return proof

    @property
    def root_hex(self) -> str:
        return "0x" + self.root.hex()
