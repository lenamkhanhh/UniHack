// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/MissionSpendGateway.sol";
import "../src/MissionBudgetHub.sol";
import "./mock/MockTeleporterMessenger.sol";
import "./mock/MockERC20.sol";

// Minimal forge-std Test harness interface
abstract contract TestHarness {
    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

    function assertTrue(bool condition) internal pure {
        require(condition, "Assertion failed: condition not true");
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "Assertion failed: condition not false");
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "Assertion failed: uint256 mismatch");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "Assertion failed: address mismatch");
    }

    function assertEq(bytes32 a, bytes32 b) internal pure {
        require(a == b, "Assertion failed: bytes32 mismatch");
    }

    function vm_prank(address sender) internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("prank(address)", sender));
        require(success, "vm.prank failed");
    }

    function vm_expectRevert(bytes memory revertData) internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("expectRevert(bytes)", revertData));
        require(success, "vm.expectRevert failed");
    }
}

/**
 * @title MissionCrossChainICMTest
 * @notice Acceptance test suite for M9: Avalanche Cross-L1 Mission Budgeting (Phase 1).
 * Strictly verifies security boundaries for cross-L1 budget hub (separate from GuardedTreasury):
 * 1. valid message pays (local mock, not ICM)
 * 2. wrong source chain reverts (local mock, not ICM)
 * 3. wrong sender reverts (local mock, not ICM)
 * 4. payee not in set reverts (local mock, not ICM)
 * 5. replay reverts (local mock, not ICM)
 * 6. over cap reverts (local mock, not ICM)
 * 7. unauthorized messenger reverts (local mock, not ICM)
 * 8. stranger agent reverts UnauthorizedAgent (M9-F1) (local mock, not ICM)
 * 9. zero payee root reverts InvalidPayeeRoot (M9-F2) (local mock, not ICM)
 * 10. zero payment token reverts InvalidPaymentToken (M9-F3) (local mock, not ICM)
 * 11. gateway deterministic nonce derivation (M9-F4) (local mock, not ICM)
 * 12. end-to-end gateway to hub relay (local mock, not ICM)
 *
 * NOTE: All tests in this suite run against local mock contracts and are labeled
 * "local mock, not ICM" until live testnet broadcast occurs.
 */
contract MissionCrossChainICMTest is TestHarness {
    MockTeleporterMessenger public teleporter;
    MockERC20 public usdc;
    MissionSpendGateway public gateway;
    MissionBudgetHub public hub;

    address public owner = address(0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c);
    address public agent = address(0x374b8A126FDb9e5deEc8307da385076155Af3D72);
    address public stranger = address(0x9999999999999999999999999999999999999999);

    // Verified standard test payees
    address public payee1 = address(0x1111111111111111111111111111111111111111);
    address public payee2 = address(0x2222222222222222222222222222222222222222);
    address public attackerPayee = address(0x8888888888888888888888888888888888888888);

    // Merkle tree constants matching OpenZeppelin StandardMerkleTree
    // Leaves: l1 = keccak(bytes.concat(keccak(abi.encode(payee1))))
    //         l2 = keccak(bytes.concat(keccak(abi.encode(payee2))))
    // Root: hashPair(l1, l2)
    bytes32 public constant MERKLE_ROOT = 0xc6ce8ae383124b268df66d71f0af2206e6dafb13eba0b03806eed8a4e7991329;
    bytes32 public constant L1_HASH = 0xa7409058568815d08a7ad3c7d4fd44cf1dec90c620cb31e55ad24c654f7ba34f;
    bytes32 public constant L2_HASH = 0x708e7cb9a75ffb24191120fba1c3001faa9078147150c6f2747569edbadee751;

    // Avalanche Blockchain IDs
    bytes32 public constant DISPATCH_BLOCKCHAIN_ID = bytes32(uint256(779672));
    bytes32 public constant FUJI_BLOCKCHAIN_ID = bytes32(uint256(43113));
    bytes32 public constant UNKNOWN_BLOCKCHAIN_ID = bytes32(uint256(999999));

    bytes32 public constant MISSION_ID = keccak256("mission.audit.icm.01");
    uint256 public constant MISSION_CAP = 100_000_000; // 100 USDC (6 decimals)

    function setUp() public {
        vm_prank(owner);
        teleporter = new MockTeleporterMessenger(DISPATCH_BLOCKCHAIN_ID, false);

        vm_prank(owner);
        usdc = new MockERC20();

        // Predict and deploy Gateway on Dispatch
        vm_prank(owner);
        gateway = new MissionSpendGateway(
            address(teleporter),
            FUJI_BLOCKCHAIN_ID,
            address(0) // updated below
        );

        // Deploy Hub on Fuji C-Chain with paymentToken enforced
        vm_prank(owner);
        hub = new MissionBudgetHub(
            address(teleporter),
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            address(usdc)
        );

        // Link Gateway to Hub
        vm_prank(owner);
        gateway.setDestination(FUJI_BLOCKCHAIN_ID, address(hub));

        // Register mission on Hub with designated agent (M9-F1) and non-zero root (M9-F2)
        vm_prank(owner);
        hub.registerMission(MISSION_ID, agent, MERKLE_ROOT, MISSION_CAP);

        // Fund Hub with USDC for payments
        usdc.mint(address(hub), 500_000_000); // 500 USDC
    }

    /**
     * @notice Test 1: Valid cross-chain message pays payee and tracks budget.
     * Label: (local mock, not ICM)
     */
    function test_01_valid_message_pays_local_mock() public {
        bytes32 messageId = keccak256("msg.valid.01");
        uint256 amount = 25_000_000; // 25 USDC

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        bytes memory messageData = abi.encode(
            messageId,
            MISSION_ID,
            agent, // designated agent
            payee1,
            amount,
            proof
        );

        uint256 preBalance = usdc.balanceOf(payee1);

        // Call receiveTeleporterMessage as the authorized teleporter messenger
        vm_prank(address(teleporter));
        hub.receiveTeleporterMessage(
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            messageData
        );

        // Assert payout executed and state updated correctly
        assertTrue(hub.executedMessages(messageId));
        ( , , uint256 cap, uint256 spent, bool exists, ) = hub.missions(MISSION_ID);
        assertTrue(exists);
        assertEq(cap, MISSION_CAP);
        assertEq(spent, amount);
        assertEq(usdc.balanceOf(payee1), preBalance + amount);
    }

    /**
     * @notice Test 2: Message from unauthorized source blockchain ID reverts.
     * Label: (local mock, not ICM)
     */
    function test_02_wrong_source_chain_reverts_local_mock() public {
        bytes32 messageId = keccak256("msg.wrong_chain.02");
        uint256 amount = 10_000_000;

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        bytes memory messageData = abi.encode(
            messageId,
            MISSION_ID,
            agent,
            payee1,
            amount,
            proof
        );

        vm_prank(address(teleporter));
        vm_expectRevert(bytes("WrongSourceChain"));
        hub.receiveTeleporterMessage(
            UNKNOWN_BLOCKCHAIN_ID, // Unauthorized source chain
            address(gateway),
            messageData
        );

        assertFalse(hub.executedMessages(messageId));
    }

    /**
     * @notice Test 3: Message from unauthorized origin sender address reverts.
     * Label: (local mock, not ICM)
     */
    function test_03_wrong_sender_reverts_local_mock() public {
        bytes32 messageId = keccak256("msg.wrong_sender.03");
        uint256 amount = 10_000_000;

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        bytes memory messageData = abi.encode(
            messageId,
            MISSION_ID,
            agent,
            payee1,
            amount,
            proof
        );

        address imposterGateway = address(0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF);

        vm_prank(address(teleporter));
        vm_expectRevert(bytes("WrongOriginSender"));
        hub.receiveTeleporterMessage(
            DISPATCH_BLOCKCHAIN_ID,
            imposterGateway, // Unauthorized sender
            messageData
        );

        assertFalse(hub.executedMessages(messageId));
    }

    /**
     * @notice Test 4: Payee not in owner-signed mission set reverts.
     * Label: (local mock, not ICM)
     */
    function test_04_payee_not_in_set_reverts_local_mock() public {
        bytes32 messageId = keccak256("msg.attacker_payee.04");
        uint256 amount = 15_000_000;

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L1_HASH;

        bytes memory messageData = abi.encode(
            messageId,
            MISSION_ID,
            agent,
            attackerPayee, // Attacker is NOT in MERKLE_ROOT
            amount,
            proof
        );

        vm_prank(address(teleporter));
        vm_expectRevert(bytes("PayeeNotInMissionSet"));
        hub.receiveTeleporterMessage(
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            messageData
        );

        assertFalse(hub.executedMessages(messageId));
        assertEq(usdc.balanceOf(attackerPayee), 0);
    }

    /**
     * @notice Test 5: Replay of same messageId reverts on second delivery.
     * Label: (local mock, not ICM)
     */
    function test_05_replay_reverts_local_mock() public {
        bytes32 messageId = keccak256("msg.replay.05");
        uint256 amount = 20_000_000;

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        bytes memory messageData = abi.encode(
            messageId,
            MISSION_ID,
            agent,
            payee1,
            amount,
            proof
        );

        // First delivery succeeds
        vm_prank(address(teleporter));
        hub.receiveTeleporterMessage(
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            messageData
        );
        assertTrue(hub.executedMessages(messageId));

        // Attempting to deliver identical messageId a second time reverts
        vm_prank(address(teleporter));
        vm_expectRevert(bytes("MessageAlreadyExecuted"));
        hub.receiveTeleporterMessage(
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            messageData
        );
    }

    /**
     * @notice Test 6: Cross-chain spend request exceeding mission cap reverts.
     * Label: (local mock, not ICM)
     */
    function test_06_over_cap_reverts_local_mock() public {
        bytes32 messageId = keccak256("msg.over_cap.06");
        // MISSION_CAP is 100 USDC, requesting 101 USDC
        uint256 excessiveAmount = 101_000_000;

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        bytes memory messageData = abi.encode(
            messageId,
            MISSION_ID,
            agent,
            payee1,
            excessiveAmount,
            proof
        );

        vm_prank(address(teleporter));
        vm_expectRevert(bytes("OverCap"));
        hub.receiveTeleporterMessage(
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            messageData
        );

        assertFalse(hub.executedMessages(messageId));
    }

    /**
     * @notice Test 7: Direct caller who is not teleporterMessenger reverts.
     * Label: (local mock, not ICM)
     */
    function test_07_unauthorized_messenger_reverts_local_mock() public {
        bytes32 messageId = keccak256("msg.unauth_messenger.07");
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        bytes memory messageData = abi.encode(
            messageId,
            MISSION_ID,
            agent,
            payee1,
            10_000_000,
            proof
        );

        // Caller is arbitrary user, not the configured teleporterMessenger
        vm_prank(address(0x1234567890123456789012345678901234567890));
        vm_expectRevert(bytes("UnauthorizedMessenger"));
        hub.receiveTeleporterMessage(
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            messageData
        );
    }

    /**
     * @notice Test 8 (M9-F1): Stranger calling Gateway fails with UnauthorizedAgent on Hub.
     * Label: (local mock, not ICM)
     */
    function test_08_stranger_agent_reverts_local_mock() public {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        // Enable auto-relay to test end-to-end rejection of stranger
        teleporter.setAutoRelay(true);

        // Stranger calls gateway
        vm_prank(stranger);
        vm_expectRevert(bytes("UnauthorizedAgent"));
        gateway.sendSpendRequest(
            MISSION_ID,
            payee1,
            10_000_000,
            proof
        );
    }

    /**
     * @notice Test 9 (M9-F2): Registering mission with zero payee root reverts.
     * Label: (local mock, not ICM)
     */
    function test_09_zero_payee_root_reverts_local_mock() public {
        bytes32 newMissionId = keccak256("mission.zero_root");
        vm_prank(owner);
        vm_expectRevert(bytes("InvalidPayeeRoot"));
        hub.registerMission(newMissionId, agent, bytes32(0), MISSION_CAP);
    }

    /**
     * @notice Test 10 (M9-F3): Constructing Hub with address(0) payment token reverts.
     * Label: (local mock, not ICM)
     */
    function test_10_zero_payment_token_reverts_local_mock() public {
        vm_prank(owner);
        vm_expectRevert(bytes("InvalidPaymentToken"));
        new MissionBudgetHub(
            address(teleporter),
            DISPATCH_BLOCKCHAIN_ID,
            address(gateway),
            address(0) // Invalid zero payment token
        );
    }

    /**
     * @notice Test 11 (M9-F4): Gateway derives unique, deterministic message IDs using sequential nonce.
     * Label: (local mock, not ICM)
     */
    function test_11_gateway_deterministic_nonce_derivation_local_mock() public {
        teleporter.setAutoRelay(false);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L2_HASH;

        vm_prank(agent);
        (bytes32 id1, ) = gateway.sendSpendRequest(
            MISSION_ID,
            payee1,
            5_000_000,
            proof
        );

        vm_prank(agent);
        (bytes32 id2, ) = gateway.sendSpendRequest(
            MISSION_ID,
            payee1,
            5_000_000,
            proof
        );

        assertTrue(id1 != id2);
        assertEq(id1, keccak256(abi.encode(block.chainid, address(gateway), uint256(1))));
        assertEq(id2, keccak256(abi.encode(block.chainid, address(gateway), uint256(2))));
    }

    /**
     * @notice Test 12: End-to-end Gateway -> Teleporter -> Hub execution by authorized agent.
     * Label: (local mock, not ICM)
     */
    function test_12_end_to_end_gateway_to_hub_relay_local_mock() public {
        uint256 amount = 30_000_000; // 30 USDC

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = L1_HASH; // Proof for payee2 is [L1_HASH]

        // Enable auto-relay on mock teleporter
        teleporter.setAutoRelay(true);

        uint256 preBalance = usdc.balanceOf(payee2);

        // Authorized Agent calls Gateway on Dispatch
        vm_prank(agent);
        (bytes32 messageId, uint256 teleporterMsgId) = gateway.sendSpendRequest(
            MISSION_ID,
            payee2,
            amount,
            proof
        );

        assertEq(teleporterMsgId, 1);
        assertTrue(hub.executedMessages(messageId));
        assertEq(usdc.balanceOf(payee2), preBalance + amount);
    }
}
