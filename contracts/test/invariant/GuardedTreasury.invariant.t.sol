// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../src/GuardedTreasury.sol";
import "../GuardedTreasury.t.sol";
import "./Handler.sol";

contract GuardedTreasuryInvariantTest is Test {
    GuardedTreasury public treasury;
    MockUSDC public usdc;
    Handler public handler;

    address internal owner = address(0xABCD);
    address internal agent1 = address(0x1111);
    address internal agent2 = address(0x2222);
    address internal attacker = address(0x6666);

    address internal payeeA = address(0xA111);
    address internal payeeB = address(0xB222);
    address internal payeeOutside = address(0xC333);
    address internal unallowlisted = address(0xD444);
    address internal sessionWallet = address(0xE555);

    bytes32 internal missionWithRoot = keccak256("mission_with_root");
    bytes32 internal missionWithoutRoot = keccak256("mission_without_root");

    uint256 internal perTxCap = 5_000_000;
    uint256 internal dailyCap = 20_000_000;
    uint256 internal missionCap = 10_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        treasury = new GuardedTreasury(
            address(usdc),
            owner,
            perTxCap,
            dailyCap,
            missionCap
        );

        // Fund treasury with 50 USDC
        usdc.mint(address(treasury), 50_000_000);

        // Owner configures missions
        vm_prank(owner);
        treasury.createMission(missionWithRoot, agent1, missionCap, 30 days);

        vm_prank(owner);
        treasury.createMission(missionWithoutRoot, agent2, missionCap, 30 days);

        vm_prank(owner);
        treasury.setMissionToolCap(missionWithRoot, 2_000_000);

        vm_prank(owner);
        treasury.setMissionToolCap(missionWithoutRoot, 2_000_000);

        // Allowlist setup
        vm_prank(owner);
        treasury.setRecipient(payeeA, true);

        vm_prank(owner);
        treasury.setRecipient(payeeB, true);

        vm_prank(owner);
        treasury.setRecipient(payeeOutside, true);

        // Set Merkle root for missionWithRoot
        bytes32 leafA = keccak256(bytes.concat(keccak256(abi.encode(payeeA))));
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(payeeB))));
        bytes32 root = leafA <= leafB
            ? keccak256(abi.encodePacked(leafA, leafB))
            : keccak256(abi.encodePacked(leafB, leafA));

        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionWithRoot, root);

        // Instantiate handler
        handler = new Handler(
            treasury,
            usdc
        );
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// @notice Invariant 1: Any payout from a mission must strictly obey the root active at payout time
    function invariant_payeeAlwaysInRoot() public view {
        uint256 count = handler.outflowCount();
        for (uint256 i = 0; i < count; i++) {
            (address to, bytes32 mId, , bytes32 rootAtPayout, bool allowlistedAtPayout) = handler.getOutflow(i);
            if (mId == missionWithRoot) {
                if (rootAtPayout == handler.root1()) {
                    assertTrue(to == handler.payeeA() || to == handler.payeeB());
                } else if (rootAtPayout == bytes32(0)) {
                    assertTrue(allowlistedAtPayout);
                } else {
                    revert("Unexpected outflow for unproven root");
                }
            }
        }
    }

    /// @notice Invariant 2: Total mission spent never exceeds the mission cap
    function invariant_missionSpendWithinCap() public view {
        assertTrue(treasury.missionSpent(missionWithRoot) <= missionCap);
        assertTrue(treasury.missionSpent(missionWithoutRoot) <= missionCap);
    }

    /// @notice Invariant 3: Daily spend never exceeds dailyCap
    function invariant_dailySpendWithinCap() public view {
        assertTrue(treasury.spentToday() <= treasury.dailyCap());
        uint256 day = treasury.currentDay();
        assertTrue(handler.daySpendGhost(day) <= treasury.dailyCap());
    }

    /// @notice Invariant 4: Non-owner actors cannot mutate caps, roots, or allowlists
    function invariant_nonOwnerCannotChangePolicy() public view {
        assertFalse(handler.nonOwnerChangedPolicy());
    }

    /// @notice Invariant 5: When paused, no outflows to recipients can occur
    function invariant_pausedNoOutflow() public view {
        assertFalse(handler.pausedIllegalOutflow());
    }

    /// @notice Invariant 6: Treasury USDC balance strictly equals deposited - total outflow
    function invariant_balanceAccounting() public view {
        uint256 expectedBal = handler.totalDeposited() - handler.totalOutflow();
        assertEq(usdc.balanceOf(address(treasury)), expectedBal);
    }
}
