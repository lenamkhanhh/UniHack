// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../src/GuardedTreasury.sol";
import "../GuardedTreasury.t.sol";

contract Handler is Test {
    GuardedTreasury public treasury;
    MockUSDC public usdc;

    address public constant owner = address(0xABCD);
    address public constant agent1 = address(0x1111);
    address public constant agent2 = address(0x2222);
    address public constant attacker = address(0x6666);

    address public constant payeeA = address(0xA111);
    address public constant payeeB = address(0xB222);
    address public constant payeeOutside = address(0xC333);
    address public constant unallowlisted = address(0xD444);
    address public constant sessionWallet = address(0xE555);

    bytes32 public constant missionWithRoot = keccak256("mission_with_root");
    bytes32 public constant missionWithoutRoot = keccak256("mission_without_root");

    bytes32 public immutable root1;
    bytes32 public immutable leafA;
    bytes32 public immutable leafB;

    uint256 public constant missionWithRootCap = 10_000_000;
    uint256 public constant missionWithoutRootCap = 10_000_000;

    // Ghost variables
    mapping(bytes32 => uint256) public missionSpendGhost;
    mapping(uint256 => uint256) public daySpendGhost;
    address[] public outflowRecipients;
    bytes32[] public outflowMissions;
    uint256[] public outflowAmounts;

    uint256 public totalDeposited;
    uint256 public totalOutflow;
    bool public nonOwnerChangedPolicy;
    bool public pausedIllegalOutflow;
    uint256 public opNonce;

    uint256[] public queuedProposalIds;

    constructor(
        GuardedTreasury _treasury,
        MockUSDC _usdc
    ) {
        treasury = _treasury;
        usdc = _usdc;

        bytes32 lA = keccak256(bytes.concat(keccak256(abi.encode(payeeA))));
        bytes32 lB = keccak256(bytes.concat(keccak256(abi.encode(payeeB))));
        leafA = lA;
        leafB = lB;
        root1 = lA <= lB
            ? keccak256(abi.encodePacked(lA, lB))
            : keccak256(abi.encodePacked(lB, lA));

        totalDeposited = usdc.balanceOf(address(treasury));
    }

    function recordOutflow(address to, bytes32 missionId, uint256 amount) internal {
        outflowRecipients.push(to);
        outflowMissions.push(missionId);
        outflowAmounts.push(amount);
        totalOutflow += amount;
        if (missionId != bytes32(0)) {
            missionSpendGhost[missionId] += amount;
        }
        daySpendGhost[treasury.currentDay()] += amount;
    }

    function isLeafInRoot(bytes32 missionId, address payee) external pure returns (bool) {
        if (missionId == missionWithRoot) {
            return (payee == payeeA || payee == payeeB);
        }
        return false;
    }

    function outflowCount() external view returns (uint256) {
        return outflowRecipients.length;
    }

    function getOutflow(uint256 index) external view returns (address, bytes32, uint256) {
        return (outflowRecipients[index], outflowMissions[index], outflowAmounts[index]);
    }

    // --- Action: Propose with Proof ---
    function actionProposeWithProof(
        uint256 actorIdx,
        uint256 missionIdx,
        uint256 payeeIdx,
        uint256 proofType,
        uint256 rawAmount
    ) external {
        address actor = _selectActor(actorIdx);
        bytes32 missionId = (missionIdx % 2 == 0) ? missionWithRoot : missionWithoutRoot;
        address payee = _selectPayee(payeeIdx);

        bytes32[] memory proof;
        if (proofType % 4 == 0) {
            // Valid proof
            proof = new bytes32[](1);
            if (payee == payeeA) {
                proof[0] = leafB;
            } else if (payee == payeeB) {
                proof[0] = leafA;
            } else {
                proof[0] = leafA; // invalid for payeeOutside / unallowlisted
            }
        } else if (proofType % 4 == 1) {
            // Empty proof
            proof = new bytes32[](0);
        } else if (proofType % 4 == 2) {
            // Corrupted proof
            proof = new bytes32[](1);
            proof[0] = bytes32(uint256(0xDEADBEEF));
        } else {
            // Random proof length
            proof = new bytes32[](2);
            proof[0] = leafA;
            proof[1] = leafB;
        }

        uint256 amount = (rawAmount % 6_000_000) + 1; // 1 to 6 USDC
        bytes32 opId = keccak256(abi.encodePacked("opWithProof", opNonce++));

        uint256 balBefore = usdc.balanceOf(address(treasury));
        vm_prank(actor);
        try treasury.proposeWithProof(opId, payee, amount, missionId, "proofProposal", proof) returns (uint256 pid) {
            uint256 balAfter = usdc.balanceOf(address(treasury));
            if (balAfter < balBefore) {
                // Auto executed
                recordOutflow(payee, missionId, balBefore - balAfter);
            } else {
                // Queued
                queuedProposalIds.push(pid);
            }
        } catch {
            // Revert as expected for invalid inputs/conditions
        }
    }

    // --- Action: Propose (legacy / without proof) ---
    function actionPropose(
        uint256 actorIdx,
        uint256 missionIdx,
        uint256 payeeIdx,
        uint256 rawAmount
    ) external {
        address actor = _selectActor(actorIdx);
        bytes32 missionId = (missionIdx % 2 == 0) ? missionWithRoot : missionWithoutRoot;
        address payee = _selectPayee(payeeIdx);

        uint256 amount = (rawAmount % 6_000_000) + 1;
        bytes32 opId = keccak256(abi.encodePacked("opLegacy", opNonce++));

        uint256 balBefore = usdc.balanceOf(address(treasury));
        vm_prank(actor);
        try treasury.propose(opId, payee, amount, missionId, "legacyProposal") returns (uint256 pid) {
            uint256 balAfter = usdc.balanceOf(address(treasury));
            if (balAfter < balBefore) {
                recordOutflow(payee, missionId, balBefore - balAfter);
            } else {
                queuedProposalIds.push(pid);
            }
        } catch {
            // Expected revert if mission has root or other guard triggers
        }
    }

    // --- Action: Approve and Execute Queued Proposals ---
    function actionApproveAndExecute(uint256 queueIdx, uint256 actorIdx) external {
        if (queuedProposalIds.length == 0) return;
        uint256 pid = queuedProposalIds[queueIdx % queuedProposalIds.length];
        address actor = (actorIdx % 5 == 0) ? attacker : owner;

        GuardedTreasury.Proposal memory p = treasury.getProposal(pid);
        if (p.status != 1) return; // not queued

        if (actor == owner) {
            // Owner enforces mission cap and daily cap invariant
            if (treasury.missionSpent(p.missionId) + p.amount > _getMissionCap(p.missionId)) {
                vm_prank(owner);
                try treasury.reject(pid, "CapExceeded") {} catch {}
                return;
            }
            if (treasury.spentOnDay(treasury.currentDay()) + p.amount > treasury.dailyCap()) {
                vm_prank(owner);
                try treasury.reject(pid, "DailyCapExceeded") {} catch {}
                return;
            }

            vm_prank(owner);
            try treasury.approve(pid) {
                uint256 balBefore = usdc.balanceOf(address(treasury));
                vm_prank(owner);
                try treasury.execute(pid) {
                    uint256 balAfter = usdc.balanceOf(address(treasury));
                    if (balAfter < balBefore) {
                        recordOutflow(p.to, p.missionId, balBefore - balAfter);
                    }
                } catch {}
            } catch {}
        } else {
            // Attacker attempt to approve / execute
            vm_prank(actor);
            try treasury.approve(pid) {} catch {}
            vm_prank(actor);
            try treasury.execute(pid) {} catch {}
        }
    }

    // --- Action: Reject ---
    function actionReject(uint256 queueIdx, uint256 actorIdx) external {
        if (queuedProposalIds.length == 0) return;
        uint256 pid = queuedProposalIds[queueIdx % queuedProposalIds.length];
        address actor = (actorIdx % 2 == 0) ? owner : attacker;

        vm_prank(actor);
        try treasury.reject(pid, "manualReject") {} catch {}
    }

    // --- Action: Expire ---
    function actionExpire(uint256 queueIdx) external {
        if (queuedProposalIds.length == 0) return;
        uint256 pid = queuedProposalIds[queueIdx % queuedProposalIds.length];
        try treasury.expire(pid) {} catch {}
    }

    // --- Action: Fund Mission Wallet ---
    function actionFundMissionWallet(uint256 actorIdx, uint256 missionIdx, uint256 amountRaw) external {
        address actor = (actorIdx % 4 == 0) ? owner : attacker;
        bytes32 missionId = (missionIdx % 2 == 0) ? missionWithRoot : missionWithoutRoot;
        uint256 amount = (amountRaw % 2_000_000) + 1;

        uint256 balBefore = usdc.balanceOf(address(treasury));
        vm_prank(actor);
        try treasury.fundMissionWallet(missionId, sessionWallet, amount) {
            uint256 balAfter = usdc.balanceOf(address(treasury));
            if (balAfter < balBefore) {
                totalOutflow += (balBefore - balAfter);
            }
        } catch {}
    }

    // --- Action: Set Mission Payee Root ---
    function actionSetMissionPayeeRoot(uint256 actorIdx, uint256 missionIdx, bytes32 newRoot) external {
        address actor = (actorIdx % 3 == 0) ? attacker : owner;
        bytes32 missionId = (missionIdx % 2 == 0) ? missionWithRoot : missionWithoutRoot;

        bytes32 rootBefore = treasury.missionPayeeRoot(missionId);
        uint256 versionBefore = treasury.policyVersion();

        if (actor == owner) {
            newRoot = root1;
        }

        vm_prank(actor);
        try treasury.setMissionPayeeRoot(missionId, newRoot) {
            if (actor != owner) {
                nonOwnerChangedPolicy = true;
            }
        } catch {
            if (actor != owner) {
                if (treasury.missionPayeeRoot(missionId) != rootBefore || treasury.policyVersion() != versionBefore) {
                    nonOwnerChangedPolicy = true;
                }
            }
        }
    }

    // --- Action: Pause / Unpause ---
    function actionPauseToggle(uint256 actorIdx) external {
        address actor = (actorIdx % 2 == 0) ? owner : attacker;
        vm_prank(actor);
        if (treasury.paused()) {
            try treasury.unpause() {} catch {}
        } else {
            try treasury.pause() {} catch {}
        }
    }

    // --- Action: Emergency Withdraw ---
    function actionEmergencyWithdraw(uint256 actorIdx) external {
        address actor = (actorIdx % 2 == 0) ? owner : attacker;
        uint256 balBefore = usdc.balanceOf(address(treasury));

        vm_prank(actor);
        try treasury.emergencyWithdraw() {
            uint256 balAfter = usdc.balanceOf(address(treasury));
            if (balAfter < balBefore) {
                totalOutflow += (balBefore - balAfter);
            }
        } catch {}
    }

    // --- Action: Warp Time Across Days ---
    function actionWarpTime(uint256 secondsToWarp) external {
        uint256 warp = (secondsToWarp % 3 days) + 1 hours;
        vm_warp(block.timestamp + warp);
    }

    // --- Action: Attempt Policy Changes ---
    function actionAttemptPolicyChange(
        uint256 actorIdx,
        uint256 newPerTx,
        uint256 newDaily,
        uint256 allowTargetIdx,
        bool allow
    ) external {
        address actor = (actorIdx % 4 == 0) ? owner : attacker;
        address target = _selectPayee(allowTargetIdx);

        uint256 perTxBefore = treasury.perTxCap();
        uint256 dailyBefore = treasury.dailyCap();
        uint256 policyVersionBefore = treasury.policyVersion();
        bool allowBefore = treasury.recipientAllowlist(target);

        uint256 pCap = (newPerTx % 5_000_000) + 1_000_000;
        uint256 dCap = (newDaily % 30_000_000) + 20_000_000;

        vm_prank(actor);
        try treasury.setCaps(pCap, dCap) {
            if (actor != owner) nonOwnerChangedPolicy = true;
        } catch {}

        vm_prank(actor);
        try treasury.setRecipient(target, allow) {
            if (actor != owner) nonOwnerChangedPolicy = true;
        } catch {}

        if (actor != owner) {
            if (
                treasury.perTxCap() != perTxBefore ||
                treasury.dailyCap() != dailyBefore ||
                treasury.policyVersion() != policyVersionBefore ||
                treasury.recipientAllowlist(target) != allowBefore
            ) {
                nonOwnerChangedPolicy = true;
            }
        }
    }

    // --- Internal Helpers ---
    function _selectActor(uint256 seed) internal pure returns (address) {
        uint256 m = seed % 4;
        if (m == 0) return agent1;
        if (m == 1) return agent2;
        if (m == 2) return attacker;
        return owner;
    }

    function _selectPayee(uint256 seed) internal pure returns (address) {
        uint256 m = seed % 4;
        if (m == 0) return payeeA;
        if (m == 1) return payeeB;
        if (m == 2) return payeeOutside;
        return unallowlisted;
    }

    function _getMissionCap(bytes32 missionId) internal pure returns (uint256) {
        if (missionId == missionWithRoot) return missionWithRootCap;
        return missionWithoutRootCap;
    }
}
