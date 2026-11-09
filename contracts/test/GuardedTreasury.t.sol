// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/GuardedTreasury.sol";

// Minimal forge-std Test interface for Foundry
abstract contract Test {
    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
    
    function assertTrue(bool condition) internal pure {
        require(condition, "Assertion failed: condition not true");
    }

    function assertEq(bool a, bool b) internal pure {
        require(a == b, "Assertion failed: bool mismatch");
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

    function assertEq(string memory a, string memory b) internal pure {
        require(keccak256(bytes(a)) == keccak256(bytes(b)), "Assertion failed: string mismatch");
    }

    function vm_prank(address sender) internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("prank(address)", sender));
        require(success, "vm.prank failed");
    }

    function vm_warp(uint256 newTimestamp) internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("warp(uint256)", newTimestamp));
        require(success, "vm.warp failed");
    }

    function vm_expectRevert(bytes memory revertData) internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("expectRevert(bytes)", revertData));
        require(success, "vm.expectRevert failed");
    }
}

contract MockUSDC is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 value) external override returns (bool) {
        require(balanceOf[msg.sender] >= value, "InsufficientBalance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function approve(address spender, uint256 value) external override returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external override returns (bool) {
        require(balanceOf[from] >= value, "InsufficientBalance");
        require(allowance[from][msg.sender] >= value, "InsufficientAllowance");
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }

    // EIP-3009 Native receiveWithAuthorization (simulating Fuji USDC)
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 /*nonce*/,
        uint8 /*v*/,
        bytes32 /*r*/,
        bytes32 /*s*/
    ) external {
        require(block.timestamp >= validAfter, "AuthorizationNotYetValid");
        require(block.timestamp <= validBefore, "AuthorizationExpired");
        require(balanceOf[from] >= value, "InsufficientBalance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

contract ReentrantAttackerToken is IERC20 {
    mapping(address => uint256) public override balanceOf;
    address public treasury;
    bytes32 public attackOpId;
    address public attackRecipient;
    uint256 public attackAmount;
    bytes32 public attackMissionId;
    bool public hasAttacked;

    function setTarget(
        address _treasury,
        bytes32 _opId,
        address _recipient,
        uint256 _amount,
        bytes32 _missionId
    ) external {
        treasury = _treasury;
        attackOpId = _opId;
        attackRecipient = _recipient;
        attackAmount = _amount;
        attackMissionId = _missionId;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 value) external override returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        if (!hasAttacked && treasury != address(0)) {
            hasAttacked = true;
            // Attempt reentrancy into treasury propose
            GuardedTreasury(payable(treasury)).propose(
                attackOpId,
                attackRecipient,
                attackAmount,
                attackMissionId,
                "reentrant attack"
            );
        }
        return true;
    }

    function allowance(address, address) external pure override returns (uint256) { return 0; }
    function approve(address, uint256) external pure override returns (bool) { return true; }
    function transferFrom(address, address, uint256) external pure override returns (bool) { return true; }
    function totalSupply() external pure override returns (uint256) { return 1000000000; }
}

contract GuardedTreasuryTest is Test {
    GuardedTreasury public treasury;
    MockUSDC public usdc;

    address public owner = address(0x1111);
    address public agent = address(0x2222);
    address public recipient = address(0x3333);
    address public recipientLookalike = address(0x3334);
    address public unauthorized = address(0x9999);

    bytes32 public missionId = keccak256("mission-test-01");
    uint256 public perTxCap = 5_000_000; // 5 USDC
    uint256 public dailyCap = 20_000_000; // 20 USDC
    uint256 public missionCap = 10_000_000; // 10 USDC

    function setUp() public {
        vm_warp(1700000000); // fixed timestamp
        usdc = new MockUSDC();
        treasury = new GuardedTreasury(
            address(usdc),
            owner,
            perTxCap,
            dailyCap,
            missionCap
        );

        // Fund treasury
        usdc.mint(address(treasury), 100_000_000); // 100 USDC

        // Owner setups
        vm_prank(owner);
        treasury.setRecipient(recipient, true);

        vm_prank(owner);
        treasury.createMission(missionId, agent, missionCap, 24 hours);
    }

    // C1: Active mission, allowlisted recipient, amount=perTx cap => Auto Executed in propose
    function test_C1_auto_executed_in_propose() public {
        bytes32 opId = keccak256("op-c1");
        vm_prank(agent);
        uint256 propId = treasury.propose(opId, recipient, perTxCap, missionId, "Valid payout");

        assertEq(propId, 0);
        assertEq(usdc.balanceOf(recipient), perTxCap);
        assertEq(treasury.spentToday(), perTxCap);
        assertEq(treasury.missionSpent(missionId), perTxCap);

        assertEq(treasury.getProposal(propId).status, 3); // Executed
    }

    // C2: Vượt perTx => Queued, không transfer
    function test_C2_over_per_tx_queued() public {
        bytes32 opId = keccak256("op-c2");
        vm_prank(agent);
        uint256 propId = treasury.propose(opId, recipient, perTxCap + 1, missionId, "Over per tx");

        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(treasury.spentToday(), 0);
        GuardedTreasury.Proposal memory p = treasury.getProposal(propId);
        assertEq(p.status, 1); // Queued
        assertEq(p.queueReason, "OverPerTxCap");
    }

    // C3: Vượt UTC daily sau khoản chi trước => Queued; qua ngày UTC mới có budget mới
    function test_C3_over_daily_queued_utc_reset() public {
        // Increase mission cap so daily cap is the binding limit
        vm_prank(owner);
        treasury.setMissionCap(missionId, 50_000_000);

        // Spend up to 15 USDC
        vm_prank(agent);
        treasury.propose(keccak256("op-c3-1"), recipient, 5_000_000, missionId, "Spend 1");
        vm_prank(agent);
        treasury.propose(keccak256("op-c3-2"), recipient, 5_000_000, missionId, "Spend 2");
        vm_prank(agent);
        treasury.propose(keccak256("op-c3-3"), recipient, 5_000_000, missionId, "Spend 3");

        // Next 5_000_001 exceeds dailyCap 20_000_000 and exceeds perTxCap 5_000_000
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c3-4"), recipient, 5_000_001, missionId, "Exceed daily");
        GuardedTreasury.Proposal memory p4 = treasury.getProposal(propId);
        assertEq(p4.status, 1); // Queued
        assertEq(p4.queueReason, "OverPerTxCap"); // perTx cap checked first

        // Try 5_000_000 (total would be 20_000_000, which is <= 20_000_000)
        vm_prank(agent);
        treasury.propose(keccak256("op-c3-5"), recipient, 5_000_000, missionId, "Hit daily");
        assertEq(treasury.spentToday(), 20_000_000);

        // Next 1_000_000 in same day queues with OverDailyCap
        vm_prank(agent);
        uint256 propId6 = treasury.propose(keccak256("op-c3-6"), recipient, 1_000_000, missionId, "Over daily");
        GuardedTreasury.Proposal memory p6 = treasury.getProposal(propId6);
        assertEq(p6.status, 1);
        assertEq(p6.queueReason, "OverDailyCap");

        // Advance to next UTC day
        vm_warp(block.timestamp + 1 days + 1);
        assertEq(treasury.spentToday(), 0); // New day reset
    }

    // C4: Vượt mission cap => Queued, missionSpent không tăng
    function test_C4_over_mission_cap_queued() public {
        vm_prank(agent);
        treasury.propose(keccak256("op-c4-1"), recipient, 5_000_000, missionId, "Spend 1");
        vm_prank(agent);
        treasury.propose(keccak256("op-c4-2"), recipient, 5_000_000, missionId, "Spend 2");
        assertEq(treasury.missionSpent(missionId), 10_000_000);

        // Next proposal exceeds missionCap (10_000_000)
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c4-3"), recipient, 1_000_000, missionId, "Over mission");
        GuardedTreasury.Proposal memory p = treasury.getProposal(propId);
        assertEq(p.status, 1);
        assertEq(p.queueReason, "OverMissionCap");
        assertEq(treasury.missionSpent(missionId), 10_000_000); // unchanged
    }

    // C5: Mission zero/nonexistent/closed/expired/wrong agent => Revert
    function test_C5_invalid_mission_reverts() public {
        vm_expectRevert(bytes("InvalidMissionId"));
        vm_prank(agent);
        treasury.propose(keccak256("op-1"), recipient, 1_000_000, bytes32(0), "Zero mission");

        vm_expectRevert(bytes("InvalidMission"));
        vm_prank(agent);
        treasury.propose(keccak256("op-2"), recipient, 1_000_000, keccak256("nonexistent"), "Nonexistent");

        // Wrong agent on active mission
        vm_expectRevert(bytes("NotMissionAgent"));
        vm_prank(unauthorized);
        treasury.propose(keccak256("op-3"), recipient, 1_000_000, missionId, "Wrong agent");

        // Closed mission
        bytes32 closedMissionId = keccak256("mission-closed-test");
        vm_prank(owner);
        treasury.createMission(closedMissionId, agent, 10_000_000, 24 hours);
        vm_prank(owner);
        treasury.closeMission(closedMissionId);

        vm_expectRevert(bytes("MissionClosed"));
        vm_prank(agent);
        treasury.propose(keccak256("op-4"), recipient, 1_000_000, closedMissionId, "Closed");

        // Expire mission
        vm_warp(block.timestamp + 25 hours);
        vm_expectRevert(bytes("MissionExpired"));
        vm_prank(agent);
        treasury.propose(keccak256("op-5"), recipient, 1_000_000, missionId, "Expired");
    }

    // C6: Recipient zero/not allowlisted => Revert kể cả amount đồng thời over cap
    function test_C6_not_allowlisted_revert_even_over_cap() public {
        vm_expectRevert(bytes("NotAllowlisted"));
        vm_prank(agent);
        // Over cap (50 USDC) AND not allowlisted (unauthorized): BLOCK before QUEUE
        treasury.propose(keccak256("op-c6"), unauthorized, 50_000_000, missionId, "Block before queue");
    }

    // C7: Lookalike khác full address => Revert
    function test_C7_lookalike_recipient_reverts() public {
        vm_expectRevert(bytes("NotAllowlisted"));
        vm_prank(agent);
        treasury.propose(keccak256("op-c7"), recipientLookalike, 1_000_000, missionId, "Lookalike");
    }

    // C8: Queued → owner approve → execute => hai tx riêng; đúng balances/status
    function test_C8_queued_approve_execute() public {
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c8"), recipient, 6_000_000, missionId, "Queued over perTx");

        // Owner approves
        vm_prank(owner);
        treasury.approve(propId);
        assertEq(treasury.getProposal(propId).status, 2); // Approved
        assertEq(usdc.balanceOf(recipient), 0); // Not transferred yet

        // Owner executes
        vm_prank(owner);
        treasury.execute(propId);
        assertEq(treasury.getProposal(propId).status, 3); // Executed
        assertEq(usdc.balanceOf(recipient), 6_000_000);
        assertEq(treasury.spentToday(), 6_000_000);
    }

    // C9: Queued hoặc Approved → reject => no transfer, execute sau reject revert
    function test_C9_reject_prevents_execute() public {
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c9"), recipient, 6_000_000, missionId, "Queued");

        vm_prank(owner);
        treasury.reject(propId, "Owner denied");
        assertEq(treasury.getProposal(propId).status, 4); // Rejected

        vm_expectRevert(bytes("NotApproved"));
        vm_prank(owner);
        treasury.execute(propId);
    }

    // C10: Pause propose/approve/execute, rồi unpause
    function test_C10_pause_unpause() public {
        // Create a queued proposal before pause
        vm_prank(agent);
        uint256 queuedPropId = treasury.propose(keccak256("op-c10-q"), recipient, 6_000_000, missionId, "Queued 1");

        // Approve it first to test execute when paused
        vm_prank(owner);
        treasury.approve(queuedPropId);

        // Create another queued proposal
        vm_prank(agent);
        uint256 queuedPropId2 = treasury.propose(keccak256("op-c10-q2"), recipient, 6_000_000, missionId, "Queued 2");

        vm_prank(owner);
        treasury.pause();

        // 1. Propose reverts when paused
        vm_expectRevert(bytes("Paused"));
        vm_prank(agent);
        treasury.propose(keccak256("op-c10"), recipient, 1_000_000, missionId, "Paused");

        // 2. Approve reverts when paused
        vm_expectRevert(bytes("Pausable: paused"));
        vm_prank(owner);
        treasury.approve(queuedPropId2);

        // 3. Execute reverts when paused
        vm_expectRevert(bytes("Pausable: paused"));
        vm_prank(owner);
        treasury.execute(queuedPropId);

        vm_prank(owner);
        treasury.unpause();

        // After unpause: propose works
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c10-post"), recipient, 1_000_000, missionId, "Unpaused");
        assertEq(treasury.getProposal(propId).status, 3); // Executed

        // Approve works
        vm_prank(owner);
        treasury.approve(queuedPropId2);
        assertEq(treasury.getProposal(queuedPropId2).status, 2); // Approved

        // Execute works
        vm_prank(owner);
        treasury.execute(queuedPropId);
        assertEq(treasury.getProposal(queuedPropId).status, 3); // Executed
    }

    // C11: Agent gọi owner functions => Revert
    function test_C11_agent_calling_owner_functions_reverts() public {
        vm_expectRevert(bytes("Ownable: caller is not the owner"));
        vm_prank(agent);
        treasury.pause();

        vm_expectRevert(bytes("Ownable: caller is not the owner"));
        vm_prank(agent);
        treasury.setCaps(1, 1);
    }

    // C12: Agent gọi direct transfer/arbitrary approve path => Không có supported path
    function test_C12_no_direct_agent_transfer_path() public {
        // Direct ether call reverts via receive()
        vm_expectRevert(bytes("DirectEtherNotAccepted"));
        (bool ok, ) = address(treasury).call{value: 1}("");
        assertTrue(ok);
    }

    // C13: Expiry của Queued/Approved và mission
    function test_C13_proposal_and_mission_expiry() public {
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c13"), recipient, 6_000_000, missionId, "Over perTx");

        // Warp past 48 hours
        vm_warp(block.timestamp + 49 hours);

        vm_expectRevert(bytes("ProposalExpired"));
        vm_prank(owner);
        treasury.approve(propId);

        // Expire function cleans up
        treasury.expire(propId);
        assertEq(treasury.getProposal(propId).status, 5); // Expired
    }

    // C14: Approve/execute lặp => Revert
    function test_C14_repeated_approve_execute_reverts() public {
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c14"), recipient, 6_000_000, missionId, "Over perTx");

        vm_prank(owner);
        treasury.approve(propId);

        vm_expectRevert(bytes("NotQueued"));
        vm_prank(owner);
        treasury.approve(propId);

        vm_prank(owner);
        treasury.execute(propId);

        vm_expectRevert(bytes("NotApproved"));
        vm_prank(owner);
        treasury.execute(propId);
    }

    // C15: Gỡ recipient sau queue/approve => Execute revert, status còn Approved
    function test_C15_remove_recipient_blocks_execute() public {
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c15"), recipient, 6_000_000, missionId, "Over perTx");

        vm_prank(owner);
        treasury.approve(propId);

        // Remove recipient
        vm_prank(owner);
        treasury.setRecipient(recipient, false);

        vm_expectRevert(bytes("RecipientNotAllowlisted"));
        vm_prank(owner);
        treasury.execute(propId);

        assertEq(treasury.getProposal(propId).status, 2); // Remains Approved
    }

    // C16: Owner override soft caps => Accounting đủ amount, overBy visible; next auto request queues
    function test_C16_owner_override_soft_caps() public {
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c16-1"), recipient, 25_000_000, missionId, "Exceed daily");

        vm_prank(owner);
        treasury.approve(propId);
        vm_prank(owner);
        treasury.execute(propId);

        assertEq(treasury.spentToday(), 25_000_000); // Recorded full amount

        // Next auto request queues
        vm_prank(agent);
        uint256 nextPropId = treasury.propose(keccak256("op-c16-2"), recipient, 1_000_000, missionId, "Next");
        assertEq(treasury.getProposal(nextPropId).status, 1); // Queued
    }

    // C17: Nới/siết policy và mission expiry giữa hai tx
    function test_C17_policy_change_does_not_auto_run() public {
        vm_prank(agent);
        uint256 propId = treasury.propose(keccak256("op-c17"), recipient, 6_000_000, missionId, "Queued");

        // Increase perTxCap to 10 USDC
        vm_prank(owner);
        treasury.setCaps(10_000_000, dailyCap);

        // Proposal does NOT auto-execute; still requires approve & execute
        assertEq(treasury.getProposal(propId).status, 1); // Still Queued
    }

    // C18: Reentrant token mock vào propose/execute => NonReentrant + CEI; không double-spend
    function test_C18_reentrancy_protection() public {
        ReentrantAttackerToken reentrantToken = new ReentrantAttackerToken();
        GuardedTreasury reentrantTreasury = new GuardedTreasury(
            address(reentrantToken),
            owner,
            perTxCap,
            dailyCap,
            missionCap
        );
        reentrantToken.mint(address(reentrantTreasury), 50_000_000);

        vm_prank(owner);
        reentrantTreasury.setRecipient(recipient, true);
        vm_prank(owner);
        reentrantTreasury.createMission(missionId, agent, missionCap, 24 hours);

        reentrantToken.setTarget(
            address(reentrantTreasury),
            keccak256("reentrant-op-2"),
            recipient,
            1_000_000,
            missionId
        );

        // Attempt propose which triggers reentrant transfer
        vm_expectRevert(bytes("ReentrancyGuard: reentrant call"));
        vm_prank(agent);
        reentrantTreasury.propose(keccak256("reentrant-op-1"), recipient, 1_000_000, missionId, "Attack");

        // Assert post-state invariant: no double spend, zero state modifications
        assertEq(reentrantTreasury.spentToday(), 0);
        assertEq(reentrantTreasury.missionSpent(missionId), 0);
        assertEq(reentrantTreasury.proposalCount(), 0);
        assertEq(reentrantToken.balanceOf(recipient), 0);
    }

    // C19: Duplicate operationId trong mission, kể cả auto payout => Revert DuplicateOperation
    function test_C19_duplicate_operation_reverts() public {
        bytes32 opId = keccak256("op-c19");
        vm_prank(agent);
        treasury.propose(opId, recipient, 1_000_000, missionId, "First call");

        vm_expectRevert(bytes("DuplicateOperation"));
        vm_prank(agent);
        treasury.propose(opId, recipient, 1_000_000, missionId, "Duplicate call");
    }

    // C20: Insufficient token balance / transfer revert => Proposal/accounting rollback atomically
    function test_C20_insufficient_token_balance_rollback() public {
        // Create treasury with only 2 USDC
        MockUSDC poorUsdc = new MockUSDC();
        GuardedTreasury poorTreasury = new GuardedTreasury(
            address(poorUsdc),
            owner,
            perTxCap,
            dailyCap,
            missionCap
        );
        poorUsdc.mint(address(poorTreasury), 2_000_000); // only 2 USDC

        vm_prank(owner);
        poorTreasury.setRecipient(recipient, true);
        vm_prank(owner);
        poorTreasury.createMission(missionId, agent, missionCap, 24 hours);

        // Propose 4 USDC (under perTxCap 5 USDC, so auto-transfer branch)
        vm_expectRevert(bytes("InsufficientBalance"));
        vm_prank(agent);
        poorTreasury.propose(keccak256("op-c20"), recipient, 4_000_000, missionId, "Too much");

        // Verify state did not change
        assertEq(poorTreasury.spentToday(), 0);
        assertEq(poorTreasury.missionSpent(missionId), 0);
        assertEq(poorTreasury.proposalCount(), 0);
    }

    // C21: transferOwnership/renounceOwnership => MVP revert trực tiếp
    function test_C21_ownership_transfer_disabled() public {
        vm_expectRevert(bytes("OwnershipTransferDisabled"));
        treasury.transferOwnership(address(0x1234));

        vm_expectRevert(bytes("OwnershipRenounceDisabled"));
        treasury.renounceOwnership();
    }

    // C22: Payout về agent bị hard block; no auto-refill
    function test_C22_payout_to_agent_hard_blocked() public {
        vm_prank(owner);
        treasury.setRecipient(agent, true); // Even if allowlisted

        vm_expectRevert(bytes("CannotPayAgent"));
        vm_prank(agent);
        treasury.propose(keccak256("op-c22"), agent, 1_000_000, missionId, "Refill agent");
    }

    // --- P1-A & P1-B Extension Tests (STRATEGY §4.3, §4.4 & SW-01..03) ---

    // P1-A Case 1: Owner successfully funds session wallet with toolCap (5 USDC)
    function test_P1A_fund_mission_wallet_success() public {
        address sessionWallet = address(0x5E551011);
        uint256 toolCap = 5_000_000; // 5 USDC
        uint256 treasuryBefore = usdc.balanceOf(address(treasury));

        vm_prank(owner);
        treasury.setMissionToolCap(missionId, toolCap);

        vm_prank(owner);
        treasury.fundMissionWallet(missionId, sessionWallet, toolCap);

        assertEq(treasury.missionFunded(missionId), true);
        assertEq(treasury.missionSessionWallet(missionId), sessionWallet);
        assertEq(usdc.balanceOf(sessionWallet), toolCap);
        assertEq(usdc.balanceOf(address(treasury)), treasuryBefore - toolCap);
    }

    // SW-03: Funding without tool cap set or exceeding cap strictly reverts
    function test_SW03_fund_without_toolcap_or_over_toolcap_reverts() public {
        address sessionWallet = address(0x5E551011);
        bytes32 freshMissionId = keccak256("fresh-mission-no-cap");

        vm_prank(owner);
        treasury.createMission(freshMissionId, agent, 10_000_000, 24 hours);

        // 1. Without tool cap set -> reverts
        vm_expectRevert(bytes("MissionToolCapNotSet"));
        vm_prank(owner);
        treasury.fundMissionWallet(freshMissionId, sessionWallet, 2_000_000);

        // Set tool cap to 3 USDC
        vm_prank(owner);
        treasury.setMissionToolCap(freshMissionId, 3_000_000);

        // 2. Amount > tool cap -> reverts
        vm_expectRevert(bytes("AmountExceedsToolCap"));
        vm_prank(owner);
        treasury.fundMissionWallet(freshMissionId, sessionWallet, 4_000_000);

        // 3. Amount <= tool cap -> succeeds
        vm_prank(owner);
        treasury.fundMissionWallet(freshMissionId, sessionWallet, 3_000_000);
        assertEq(treasury.missionFunded(freshMissionId), true);
    }

    // P1-A Case 2: Funding twice for the same mission strictly reverts
    function test_P1A_fund_twice_reverts() public {
        address sessionWallet = address(0x5E551011);
        vm_prank(owner);
        treasury.setMissionToolCap(missionId, 5_000_000);

        vm_prank(owner);
        treasury.fundMissionWallet(missionId, sessionWallet, 2_000_000);

        vm_expectRevert(bytes("MissionAlreadyFunded"));
        vm_prank(owner);
        treasury.fundMissionWallet(missionId, sessionWallet, 2_000_000);
    }

    // P1-A Case 3: Funding exceeding treasury balance reverts
    function test_P1A_fund_exceeding_treasury_balance_reverts() public {
        address sessionWallet = address(0x5E551011);
        uint256 excessiveAmount = usdc.balanceOf(address(treasury)) + 1_000_000;

        vm_prank(owner);
        treasury.setMissionToolCap(missionId, excessiveAmount);

        vm_expectRevert(bytes("InsufficientTreasuryBalance"));
        vm_prank(owner);
        treasury.fundMissionWallet(missionId, sessionWallet, excessiveAmount);
    }

    // P1-A Case 4: Non-owner / agent calling fundMissionWallet reverts
    function test_P1A_agent_fund_reverts() public {
        address sessionWallet = address(0x5E551011);
        vm_prank(owner);
        treasury.setMissionToolCap(missionId, 2_000_000);

        vm_expectRevert(bytes("Ownable: caller is not the owner"));
        vm_prank(agent);
        treasury.fundMissionWallet(missionId, sessionWallet, 1_000_000);
    }

    // P1-A Case 5: Closed or expired mission cannot be funded
    function test_P1A_fund_closed_or_expired_reverts() public {
        address sessionWallet = address(0x5E551011);

        // 1. Closed mission
        bytes32 closedMissionId = keccak256("closed-mission");
        vm_prank(owner);
        treasury.createMission(closedMissionId, agent, 10_000_000, 24 hours);
        vm_prank(owner);
        treasury.setMissionToolCap(closedMissionId, 2_000_000);
        vm_prank(owner);
        treasury.closeMission(closedMissionId);

        vm_expectRevert(bytes("MissionAlreadyClosed"));
        vm_prank(owner);
        treasury.fundMissionWallet(closedMissionId, sessionWallet, 1_000_000);

        // 2. Expired mission
        bytes32 expiredMissionId = keccak256("expired-mission");
        vm_prank(owner);
        treasury.createMission(expiredMissionId, agent, 10_000_000, 1 hours);
        vm_prank(owner);
        treasury.setMissionToolCap(expiredMissionId, 2_000_000);
        vm_warp(block.timestamp + 2 hours);

        vm_expectRevert(bytes("MissionExpired"));
        vm_prank(owner);
        treasury.fundMissionWallet(expiredMissionId, sessionWallet, 1_000_000);
    }

    // SW-02: Gasless sweep using EIP-3009 receiveWithAuthorization (ZERO approve, ZERO gas from session wallet)
    function test_SW02_sweep_mission_wallet_gasless_authorization() public {
        address sessionWallet = address(0x5E551011);
        uint256 toolCap = 5_000_000;

        vm_prank(owner);
        treasury.setMissionToolCap(missionId, toolCap);
        vm_prank(owner);
        treasury.fundMissionWallet(missionId, sessionWallet, toolCap);

        // Session wallet spent 3 USDC, 2 USDC remaining to be swept
        uint256 unusedAmount = 2_000_000;
        uint256 treasuryBefore = usdc.balanceOf(address(treasury));

        // Off-chain EIP-3009 authorization parameters signed by session wallet
        uint256 validAfter = block.timestamp - 60;
        uint256 validBefore = block.timestamp + 3600;
        bytes32 nonce = keccak256("sweep-nonce-1");
        uint8 v = 27;
        bytes32 r = keccak256("mock-r");
        bytes32 s = keccak256("mock-s");

        // Notice: ZERO vm_prank(sessionWallet), ZERO usdc.approve!
        // Owner submits transaction and pays gas:
        vm_prank(owner);
        treasury.sweepMissionWalletWithAuthorization(
            missionId,
            unusedAmount,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );

        assertEq(usdc.balanceOf(address(treasury)), treasuryBefore + unusedAmount);
        assertEq(usdc.balanceOf(sessionWallet), toolCap - unusedAmount);
    }

    // P1-B Case 1: Owner anchors cryptographic proof hash on-chain
    function test_P1B_anchor_mission_proof() public {
        bytes32 headHash = keccak256("proof-head-hash-step-3");

        vm_prank(owner);
        treasury.anchorMissionProof(missionId, headHash);

        assertEq(treasury.anchoredMissionProofs(missionId), headHash);
    }

    // P1-B Case 2: Non-owner or zero hash reverts
    function test_P1B_anchor_guards_revert() public {
        bytes32 headHash = keccak256("proof-head-hash");

        // Non-owner reverts
        vm_expectRevert(bytes("Ownable: caller is not the owner"));
        vm_prank(agent);
        treasury.anchorMissionProof(missionId, headHash);

        // Zero hash reverts
        vm_expectRevert(bytes("InvalidHeadHash"));
        vm_prank(owner);
        treasury.anchorMissionProof(missionId, bytes32(0));

        // Nonexistent mission reverts
        vm_expectRevert(bytes("MissionNotFound"));
        vm_prank(owner);
        treasury.anchorMissionProof(keccak256("unknown-mission"), headHash);
    }

    // --- PV-1: Mission Payee Merkle Root & Proof Tests ---

    function test_PV1_setMissionPayeeRoot_success_and_policy_advances() public {
        bytes32 root = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;
        uint256 pvBefore = treasury.policyVersion();

        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root);

        assertEq(treasury.missionPayeeRoot(missionId), root);
        assertEq(treasury.policyVersion(), pvBefore + 1);

        // Non-owner reverts
        vm_expectRevert(bytes("Ownable: caller is not the owner"));
        vm_prank(agent);
        treasury.setMissionPayeeRoot(missionId, root);

        // Nonexistent mission reverts
        vm_expectRevert(bytes("MissionNotFound"));
        vm_prank(owner);
        treasury.setMissionPayeeRoot(keccak256("unknown-mission"), root);

        // Closed mission reverts
        vm_prank(owner);
        treasury.closeMission(missionId);
        vm_expectRevert(bytes("MissionAlreadyClosed"));
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root);
    }

    function test_PV1_root_empty_behaves_as_before() public {
        // missionPayeeRoot is 0 by default
        assertEq(treasury.missionPayeeRoot(missionId), bytes32(0));

        // Classic propose works without proof
        vm_prank(agent);
        uint256 id1 = treasury.propose(keccak256("op-pv1-classic"), recipient, 1_000_000, missionId, "No root set");
        assertEq(treasury.getProposal(id1).status, 3); // Executed

        // proposeWithProof also succeeds when root is empty
        bytes32[] memory emptyProof = new bytes32[](0);
        vm_prank(agent);
        uint256 id2 = treasury.proposeWithProof(keccak256("op-pv1-proof-empty-root"), recipient, 1_000_000, missionId, "Empty root", emptyProof);
        assertEq(treasury.getProposal(id2).status, 3); // Executed
    }

    function test_PV1_propose_reverts_when_root_is_set() public {
        bytes32 root = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root);

        // Legacy propose must revert with PayeeProofRequired
        vm_expectRevert(bytes("PayeeProofRequired"));
        vm_prank(agent);
        treasury.propose(keccak256("op-pv1-fail"), recipient, 1_000_000, missionId, "Must fail");
    }

    function test_PV1_proposeWithProof_valid_proof_executes_and_queues() public {
        address payeeA = 0x2222222222222222222222222222222222222222;
        bytes32 root = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = 0xbd164a4590db938a0b098da1b25cf37b155f857b38c37c016ad5b8f8fce80192;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root);

        // Execute branch under perTxCap (1 USDC)
        vm_prank(agent);
        uint256 p1 = treasury.proposeWithProof(keccak256("op-pv1-exec"), payeeA, 1_000_000, missionId, "Valid proof exec", proofA);
        assertEq(treasury.getProposal(p1).status, 3); // Executed
        assertEq(usdc.balanceOf(payeeA), 1_000_000);

        // Queue branch over perTxCap (6 USDC)
        vm_prank(agent);
        uint256 p2 = treasury.proposeWithProof(keccak256("op-pv1-queue"), payeeA, 6_000_000, missionId, "Valid proof queue", proofA);
        assertEq(treasury.getProposal(p2).status, 1); // Queued
        assertEq(treasury.getProposal(p2).queueReason, "OverPerTxCap");
    }

    function test_PV1_proposeWithProof_invalid_proof_or_unauthorized_payee_reverts() public {
        address payeeA = 0x2222222222222222222222222222222222222222;
        address outsider = 0x9999999999999999999999999999999999999999;
        bytes32 root = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setRecipient(outsider, true);
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root);

        // Invalid proof for payeeA
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("fake-sibling");
        vm_expectRevert(bytes("PayeeNotInMissionSet"));
        vm_prank(agent);
        treasury.proposeWithProof(keccak256("op-pv1-badproof"), payeeA, 1_000_000, missionId, "Bad proof", badProof);

        // Valid proof of payeeA used for outsider
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = 0xbd164a4590db938a0b098da1b25cf37b155f857b38c37c016ad5b8f8fce80192;
        vm_expectRevert(bytes("PayeeNotInMissionSet"));
        vm_prank(agent);
        treasury.proposeWithProof(keccak256("op-pv1-outsider"), outsider, 1_000_000, missionId, "Outsider", proofA);
    }

    function test_PV1_cross_vector_typescript_vector_verifies() public {
        // Cross-verification vector generated by @openzeppelin/merkle-tree in TypeScript
        address payeeA = 0x2222222222222222222222222222222222222222;
        address payeeB = 0x3333333333333333333333333333333333333333;
        bytes32 root = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;

        bytes32[] memory proofB = new bytes32[](1);
        proofB[0] = 0x708e7cb9a75ffb24191120fba1c3001faa9078147150c6f2747569edbadee751;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setRecipient(payeeB, true);
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root);

        // Propose to payeeB with TypeScript generated proof
        vm_prank(agent);
        uint256 pId = treasury.proposeWithProof(keccak256("op-cross-vector"), payeeB, 2_000_000, missionId, "TS Cross Vector PayeeB", proofB);
        assertEq(treasury.getProposal(pId).status, 3); // Executed
        assertEq(usdc.balanceOf(payeeB), 2_000_000);
    }

    // Regression test for M9-F14: owner reset root to 0 legitimately switches back to global allowlist mode
    function test_PV1_owner_reset_root_zero_allows_allowlist_payee() public {
        address payeeA = 0x2222222222222222222222222222222222222222;
        bytes32 root = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setRecipient(recipient, true); // non-member in global allowlist

        // 1. Owner sets root
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root);
        assertEq(treasury.missionPayeeRoot(missionId), root);

        // recipient is NOT in root, so propose reverts with PayeeProofRequired
        vm_expectRevert(bytes("PayeeProofRequired"));
        vm_prank(agent);
        treasury.propose(keccak256("op-pv1-revert-with-root"), recipient, 1_000_000, missionId, "Root active");

        // 2. Owner resets root to bytes32(0) (downgrade to global allowlist)
        uint256 pvBefore = treasury.policyVersion();
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, bytes32(0));
        assertEq(treasury.missionPayeeRoot(missionId), bytes32(0));
        assertEq(treasury.policyVersion(), pvBefore + 1);

        // 3. Now propose to allowlisted recipient without proof succeeds
        vm_prank(agent);
        uint256 pid = treasury.propose(keccak256("op-pv1-succeed-after-reset"), recipient, 1_000_000, missionId, "Root reset to 0");
        assertEq(treasury.getProposal(pid).status, 3); // Executed
    }

    // ==========================================
    // A1: Queue Must Obey Active Payee Policy
    // ==========================================

    function test_A1_root_changed_before_approve_reverts() public {
        address payeeA = 0x2222222222222222222222222222222222222222;
        bytes32 root1 = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = 0xbd164a4590db938a0b098da1b25cf37b155f857b38c37c016ad5b8f8fce80192;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root1);

        // Propose over perTxCap (6 USDC > 5 USDC perTxCap) -> Queued
        vm_prank(agent);
        uint256 pid = treasury.proposeWithProof(
            keccak256("op-a1-queue-1"),
            payeeA,
            6_000_000,
            missionId,
            "Queued payout to payeeA",
            proofA
        );
        assertEq(treasury.getProposal(pid).status, 1); // Queued
        assertEq(treasury.proposalPayeeRootSnapshot(pid), root1);

        // Owner changes root to a new root (where payeeA is removed)
        bytes32 root2 = keccak256("new-root-without-payeeA");
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root2);

        // Attempting to approve must revert with ProposalPayeePolicyChanged
        vm_expectRevert(bytes("ProposalPayeePolicyChanged"));
        vm_prank(owner);
        treasury.approve(pid);
    }

    function test_A1_root_changed_after_approve_before_execute_reverts() public {
        address payeeA = 0x2222222222222222222222222222222222222222;
        bytes32 root1 = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = 0xbd164a4590db938a0b098da1b25cf37b155f857b38c37c016ad5b8f8fce80192;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root1);

        // Propose 6 USDC -> Queued
        vm_prank(agent);
        uint256 pid = treasury.proposeWithProof(
            keccak256("op-a1-queue-2"),
            payeeA,
            6_000_000,
            missionId,
            "Queued payout",
            proofA
        );

        // Owner approves while root1 is still active
        vm_prank(owner);
        treasury.approve(pid);
        assertEq(treasury.getProposal(pid).status, 2); // Approved

        // Owner then updates root to root2 before execution
        bytes32 root2 = keccak256("new-root-payeeA-removed");
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root2);

        // Execution must be rejected because root changed
        vm_expectRevert(bytes("ProposalPayeePolicyChanged"));
        vm_prank(owner);
        treasury.execute(pid);

        // Verify payeeA received 0 USDC
        assertEq(usdc.balanceOf(payeeA), 0);
    }

    function test_A1_root_zero_to_nonzero_reverts() public {
        // Mission starts without root (missionPayeeRoot == 0)
        vm_prank(owner);
        treasury.setRecipient(recipient, true);

        // Propose 6 USDC over perTxCap -> Queued under root 0
        vm_prank(agent);
        uint256 pid = treasury.propose(
            keccak256("op-a1-root0"),
            recipient,
            6_000_000,
            missionId,
            "Root 0 proposal"
        );
        assertEq(treasury.proposalPayeeRootSnapshot(pid), bytes32(0));

        // Owner then sets a nonzero Merkle root
        bytes32 newRoot = keccak256("some-merkle-root");
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, newRoot);

        // Approve must revert because root transitioned from 0 to nonzero
        vm_expectRevert(bytes("ProposalPayeePolicyChanged"));
        vm_prank(owner);
        treasury.approve(pid);
    }

    function test_A1_unchanged_root_executes_once_successfully() public {
        address payeeA = 0x2222222222222222222222222222222222222222;
        bytes32 root1 = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = 0xbd164a4590db938a0b098da1b25cf37b155f857b38c37c016ad5b8f8fce80192;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root1);

        vm_prank(agent);
        uint256 pid = treasury.proposeWithProof(
            keccak256("op-a1-unchanged"),
            payeeA,
            6_000_000,
            missionId,
            "Valid queued payout",
            proofA
        );

        // Approve with unchanged root
        vm_prank(owner);
        treasury.approve(pid);
        assertEq(treasury.getProposal(pid).status, 2);

        // Execute with unchanged root
        vm_prank(owner);
        treasury.execute(pid);
        assertEq(treasury.getProposal(pid).status, 3);
        assertEq(usdc.balanceOf(payeeA), 6_000_000);

        // Cannot re-execute
        vm_expectRevert(bytes("NotApproved"));
        vm_prank(owner);
        treasury.execute(pid);
    }

    function test_A1_removed_payee_does_not_receive_funds() public {
        address payeeA = 0x2222222222222222222222222222222222222222;
        address payeeB = 0x3333333333333333333333333333333333333333;
        bytes32 root1 = 0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320;
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = 0xbd164a4590db938a0b098da1b25cf37b155f857b38c37c016ad5b8f8fce80192;

        vm_prank(owner);
        treasury.setRecipient(payeeA, true);
        vm_prank(owner);
        treasury.setRecipient(payeeB, true);
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, root1);

        // Proposal for payeeA
        vm_prank(agent);
        uint256 pid = treasury.proposeWithProof(
            keccak256("op-a1-payee-removal"),
            payeeA,
            6_000_000,
            missionId,
            "Payout to payeeA",
            proofA
        );

        // Owner decides to remove payeeA from mission set: new root only authorizes payeeB
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(payeeB))));
        bytes32 rootBOnly = leafB; // single-leaf root
        vm_prank(owner);
        treasury.setMissionPayeeRoot(missionId, rootBOnly);

        // Sequence regression: in old code, owner could approve & execute, giving funds to payeeA under rootBOnly!
        // In new code, approve fails:
        vm_expectRevert(bytes("ProposalPayeePolicyChanged"));
        vm_prank(owner);
        treasury.approve(pid);

        // payeeA balance remains 0
        assertEq(usdc.balanceOf(payeeA), 0);
    }
}
