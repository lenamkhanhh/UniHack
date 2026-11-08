// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./GuardedTreasuryMutant.sol";
import "../../../src/GuardedTreasury.sol";
import "../../GuardedTreasury.t.sol";
import "../Handler.sol";

contract MutantInvariantTest is Test {
    GuardedTreasuryMutant public mutantTreasury;
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
        mutantTreasury = new GuardedTreasuryMutant(
            address(usdc),
            owner,
            perTxCap,
            dailyCap,
            missionCap
        );

        usdc.mint(address(mutantTreasury), 50_000_000);

        vm_prank(owner);
        mutantTreasury.createMission(missionWithRoot, agent1, missionCap, 30 days);

        vm_prank(owner);
        mutantTreasury.createMission(missionWithoutRoot, agent2, missionCap, 30 days);

        vm_prank(owner);
        mutantTreasury.setMissionToolCap(missionWithRoot, 2_000_000);

        vm_prank(owner);
        mutantTreasury.setRecipient(payeeA, true);

        vm_prank(owner);
        mutantTreasury.setRecipient(payeeB, true);

        vm_prank(owner);
        mutantTreasury.setRecipient(payeeOutside, true);

        bytes32 leafA = keccak256(bytes.concat(keccak256(abi.encode(payeeA))));
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(payeeB))));
        bytes32 root = leafA <= leafB
            ? keccak256(abi.encodePacked(leafA, leafB))
            : keccak256(abi.encodePacked(leafB, leafA));

        vm_prank(owner);
        mutantTreasury.setMissionPayeeRoot(missionWithRoot, root);

        // Cast mutant address to GuardedTreasury for Handler
        handler = new Handler(
            GuardedTreasury(payable(address(mutantTreasury))),
            usdc
        );
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    /// @notice Invariant must FAIL on mutant because Merkle check was removed
    function invariant_payeeAlwaysInRoot() public view {
        uint256 count = handler.outflowCount();
        for (uint256 i = 0; i < count; i++) {
            (address to, bytes32 mId, ) = handler.getOutflow(i);
            if (mId == missionWithRoot) {
                assertTrue(handler.isLeafInRoot(mId, to));
            }
        }
    }
}
