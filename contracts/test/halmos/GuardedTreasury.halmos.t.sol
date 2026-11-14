// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../src/GuardedTreasury.sol";
import "../GuardedTreasury.t.sol";

contract GuardedTreasuryHalmos is Test {
    GuardedTreasury public treasury;
    MockUSDC public usdc;

    address public owner = address(0xABCD);
    address public agent = address(0x1111);

    address public p1 = address(0x1001);
    address public p2 = address(0x1002);
    address public p3 = address(0x1003);
    address public p4 = address(0x1004);

    bytes32 public missionWithRoot = keccak256("halmos_mission_with_root");
    bytes32 public missionNoRoot = keccak256("halmos_mission_no_root");

    bytes32 public leaf1;
    bytes32 public leaf2;
    bytes32 public leaf3;
    bytes32 public leaf4;
    bytes32 public root4;

    uint256 public constant PER_TX_CAP = 5_000_000; // 5 USDC
    uint256 public constant DAILY_CAP = 20_000_000; // 20 USDC
    uint256 public constant MISSION_CAP = 50_000_000; // 50 USDC

    constructor() {
        usdc = new MockUSDC();
        treasury = new GuardedTreasury(
            address(usdc),
            owner,
            PER_TX_CAP,
            DAILY_CAP,
            MISSION_CAP
        );

        usdc.mint(address(treasury), 100_000_000);

        // Missions setup
        vm_prank(owner);
        treasury.createMission(missionWithRoot, agent, MISSION_CAP, 365 days);

        vm_prank(owner);
        treasury.createMission(missionNoRoot, agent, MISSION_CAP, 365 days);

        // Allowlist setup
        vm_prank(owner);
        treasury.setRecipient(p1, true);
        vm_prank(owner);
        treasury.setRecipient(p2, true);
        vm_prank(owner);
        treasury.setRecipient(p3, true);
        vm_prank(owner);
        treasury.setRecipient(p4, true);

        // 4-leaf Merkle root calculation
        leaf1 = _leaf(p1);
        leaf2 = _leaf(p2);
        leaf3 = _leaf(p3);
        leaf4 = _leaf(p4);

        bytes32 h12 = _hashPair(leaf1, leaf2);
        bytes32 h34 = _hashPair(leaf3, leaf4);
        root4 = _hashPair(h12, h34);

        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionWithRoot, root4);
    }

    function _leaf(address a) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a))));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// @notice Property: Only the owner can set the mission payee root
    function check_onlyOwnerSetsRoot(address caller, bytes32 missionId, bytes32 root) public {
        vm_prank(caller);
        try treasury.setMissionPayeeRoot(missionId, root) {
            assert(caller == owner);
        } catch {
            // Revert expected when caller != owner
        }
    }

    /// @notice Property: Only the owner can change caps
    function check_onlyOwnerSetsCaps(address caller, uint256 a, uint256 b) public {
        vm_prank(caller);
        try treasury.setCaps(a, b) {
            assert(caller == owner);
        } catch {
            // Revert expected when caller != owner
        }
    }

    /// @notice Property: Automatically executed proposals strictly respect per-tx cap
    function check_amountNeverExceedsPerTxCap(uint256 amount) public {
        vm_prank(agent);
        bytes32 opId = keccak256(abi.encodePacked("op", amount));
        try treasury.propose(opId, p1, amount, missionNoRoot, "check_cap") returns (uint256 pid) {
            GuardedTreasury.Proposal memory p = treasury.getProposal(pid);
            if (p.status == 3) {
                // Status 3 == Executed automatically
                assert(amount <= PER_TX_CAP);
            }
        } catch {}
    }

    /// @notice Property: Any proposal with proof for a non-member must revert (no funds leave to non-member)
    function check_proposeWithProof_rejectsNonMember(
        address to,
        uint256 amount,
        bytes32[2] memory proofArr
    ) public {
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = proofArr[0];
        proof[1] = proofArr[1];

        bytes32 opId = keccak256(abi.encodePacked("proofOp", to, amount));

        vm_prank(agent);
        try treasury.proposeWithProof(opId, to, amount, missionWithRoot, "proofCheck", proof) returns (uint256 pid) {
            // If propose succeeded without revert, `to` must be one of the authorized members
            assert(to == p1 || to == p2 || to == p3 || to == p4);
        } catch {
            // Reverted as expected for non-members
        }
    }
}
