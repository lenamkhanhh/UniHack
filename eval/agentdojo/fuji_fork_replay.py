import os
import time
from typing import List, Tuple, Dict, Any, Optional
from eth_abi import encode
from web3 import Web3
from merkle import StandardMerkleTree, iban_to_evm_address

TREASURY_ADDRESS = Web3.to_checksum_address(
    os.getenv("GUARDED_TREASURY_ADDRESS", "0x20451c1e2dCD83F166B4f22868BAdECb5868d545")
)
TREASURY_OWNER = Web3.to_checksum_address("0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c")
AGENT_ADDRESS = Web3.to_checksum_address("0x374b8A126FDb9e5deEc8307da385076155Af3D72")

PROPOSE_WITH_PROOF_ABI = [
    {
        "inputs": [
            {"internalType": "bytes32", "name": "operationId", "type": "bytes32"},
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
            {"internalType": "bytes32", "name": "missionId", "type": "bytes32"},
            {"internalType": "string", "name": "reason", "type": "string"},
            {"internalType": "bytes32[]", "name": "proof", "type": "bytes32[]"},
        ],
        "name": "proposeWithProof",
        "outputs": [{"internalType": "uint256", "name": "proposalId", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

TREASURY_ABI = [
    {
        "inputs": [
            {"internalType": "bytes32", "name": "missionId", "type": "bytes32"},
            {"internalType": "address", "name": "agent", "type": "address"},
            {"internalType": "uint256", "name": "cap", "type": "uint256"},
            {"internalType": "uint256", "name": "duration", "type": "uint256"},
        ],
        "name": "createMission",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "bytes32", "name": "missionId", "type": "bytes32"},
            {"internalType": "bytes32", "name": "root", "type": "bytes32"},
        ],
        "name": "setMissionPayeeRoot",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "address", "name": "recipient", "type": "address"},
            {"internalType": "bool", "name": "status", "type": "bool"},
        ],
        "name": "setRecipientAllowlist",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
        "name": "missions",
        "outputs": [
            {"internalType": "bytes32", "name": "id", "type": "bytes32"},
            {"internalType": "address", "name": "agent", "type": "address"},
            {"internalType": "uint256", "name": "cap", "type": "uint256"},
            {"internalType": "uint256", "name": "expiresAt", "type": "uint256"},
            {"internalType": "bool", "name": "exists", "type": "bool"},
            {"internalType": "bool", "name": "closed", "type": "bool"},
        ],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"internalType": "bytes32", "name": "operationId", "type": "bytes32"},
            {"internalType": "address", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
            {"internalType": "bytes32", "name": "missionId", "type": "bytes32"},
            {"internalType": "string", "name": "reason", "type": "string"},
            {"internalType": "bytes32[]", "name": "proof", "type": "bytes32[]"},
        ],
        "name": "proposeWithProof",
        "outputs": [{"internalType": "uint256", "name": "proposalId", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]

class FujiForkReplayer:
    """
    Simulates GuardedTreasury.sol transactions via eth_call on a local Anvil fork
    of Avalanche Fuji testnet at 0x20451c1e2dCD83F166B4f22868BAdECb5868d545.
    """
    def __init__(self, fork_rpc_url: str = "http://127.0.0.1:8546"):
        self.rpc_url = fork_rpc_url
        self.w3 = Web3(Web3.HTTPProvider(fork_rpc_url))
        self.treasury = self.w3.eth.contract(address=TREASURY_ADDRESS, abi=TREASURY_ABI)
        self._initialized_missions: Set[str] = set()

    def is_available(self) -> bool:
        try:
            return self.w3.is_connected()
        except Exception:
            return False

    def setup_task_mission(self, task_id: str, authorized_addresses: List[str], merkle_root: bytes) -> bytes32:
        mission_id = Web3.keccak(text=f"agentdojo-{task_id}")
        if task_id in self._initialized_missions:
            return mission_id

        if not self.is_available():
            return mission_id

        try:
            # Impersonate owner
            self.w3.provider.make_request("anvil_impersonateAccount", [TREASURY_OWNER])
            self.w3.provider.make_request("anvil_setBalance", [TREASURY_OWNER, "0x1000000000000000000"])

            # Check if mission exists
            mission = self.treasury.functions.missions(mission_id).call()
            if not mission[5]:  # exists
                tx = self.treasury.functions.createMission(
                    mission_id, AGENT_ADDRESS, 1_000_000_000, 86400 * 30
                ).transact({"from": TREASURY_OWNER})
                self.w3.eth.wait_for_transaction_receipt(tx)

            # Set payee root
            tx_root = self.treasury.functions.setMissionPayeeRoot(mission_id, merkle_root).transact(
                {"from": TREASURY_OWNER}
            )
            self.w3.eth.wait_for_transaction_receipt(tx_root)

            # Also allowlist authorized addresses on global list to isolate payee set Merkle verification
            for addr in authorized_addresses:
                tx_al = self.treasury.functions.setRecipientAllowlist(addr, True).transact(
                    {"from": TREASURY_OWNER}
                )
                self.w3.eth.wait_for_transaction_receipt(tx_al)

            self._initialized_missions.add(task_id)
        except Exception as e:
            # Fork setup warning
            pass

        return mission_id

    def simulate_proposal(
        self,
        task_id: str,
        recipient_address: str,
        amount_usd: float,
        proof: List[bytes],
    ) -> Tuple[bool, str]:
        """
        Executes zero-gas eth_call against GuardedTreasury on the local Fuji fork.
        """
        if not self.is_available():
            return False, "FORK_UNAVAILABLE"

        try:
            mission_id = Web3.keccak(text=f"agentdojo-{task_id}")
            amount_atomic = int(amount_usd * 1_000_000)
            op_id = Web3.keccak(text=f"call-{task_id}-{recipient_address}-{amount_atomic}-{time.time()}")
            reason = f"AgentDojo payment task {task_id}"

            # eth_call from AGENT_ADDRESS
            proposal_id = self.treasury.functions.proposeWithProof(
                op_id,
                Web3.to_checksum_address(recipient_address),
                amount_atomic,
                mission_id,
                reason[:200],
                proof,
            ).call({"from": AGENT_ADDRESS})

            return True, f"SUCCESS (proposalId: {proposal_id})"
        except Exception as e:
            err = str(e)
            if "PayeeNotInMissionSet" in err:
                return False, "REVERT: PayeeNotInMissionSet"
            if "NotAllowlisted" in err:
                return False, "REVERT: NotAllowlisted"
            if "OverPerTxCap" in err:
                return False, "REVERT: OverPerTxCap"
            return False, f"REVERT: {err[:60]}"
