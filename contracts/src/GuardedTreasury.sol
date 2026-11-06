// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @dev Interface of the ERC-20 standard.
 */
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/**
 * @dev SafeERC20 library for safe token interactions.
 */
library SafeERC20 {
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        require(address(token).code.length > 0, "SafeERC20: call to non-contract");
        bytes memory data = abi.encodeWithSelector(token.transfer.selector, to, value);
        (bool success, bytes memory returndata) = address(token).call(data);
        if (!success) {
            if (returndata.length > 0) {
                assembly {
                    let returndata_size := mload(returndata)
                    revert(add(32, returndata), returndata_size)
                }
            } else {
                revert("SafeERC20: transfer failed");
            }
        }
        require(returndata.length == 0 || abi.decode(returndata, (bool)), "SafeERC20: transfer failed");
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        require(address(token).code.length > 0, "SafeERC20: call to non-contract");
        bytes memory data = abi.encodeWithSelector(token.transferFrom.selector, from, to, value);
        (bool success, bytes memory returndata) = address(token).call(data);
        if (!success) {
            if (returndata.length > 0) {
                assembly {
                    let returndata_size := mload(returndata)
                    revert(add(32, returndata), returndata_size)
                }
            } else {
                revert("SafeERC20: transferFrom failed");
            }
        }
        require(returndata.length == 0 || abi.decode(returndata, (bool)), "SafeERC20: transferFrom failed");
    }
}

/**
 * @dev GuardedTreasury Contract
 * Spec: 01-contracts.md
 */
contract GuardedTreasury {
    using SafeERC20 for IERC20;

    // --- Events (01 §7) ---
    event MissionCreated(bytes32 indexed missionId, address indexed agent, uint256 cap, uint256 expiresAt);
    event MissionClosed(bytes32 indexed missionId);
    event MissionCapUpdated(bytes32 indexed missionId, uint256 cap);
    event PolicyVersionAdvanced(uint256 version);
    event EmergencyWithdrawn(uint256 amount);
    event Proposed(
        uint256 indexed id,
        address indexed proposer,
        address indexed to,
        uint256 amount,
        bytes32 missionId,
        bytes32 operationId
    );
    event Executed(uint256 indexed id, address indexed to, uint256 amount, bytes32 missionId);
    event Queued(uint256 indexed id, address indexed to, uint256 amount, string reason);
    event Approved(uint256 indexed id);
    event Rejected(uint256 indexed id, string reason);
    event Expired(uint256 indexed id);
    event PolicyUpdated(uint256 policyVersion, uint256 perTxCap, uint256 dailyCap);
    event AllowlistUpdated(address indexed account, bool allowed);
    event Paused(address account);
    event Unpaused(address account);
    event MissionFunded(bytes32 indexed missionId, address indexed wallet, uint256 amount);
    event MissionSwept(bytes32 indexed missionId, address indexed wallet, uint256 amount);
    event MissionProofAnchored(bytes32 indexed missionId, bytes32 indexed headHash, uint256 timestamp);

    // --- State Variables (01 §3) ---
    address public immutable USDC; // 0x5425...Bc65 Fuji USDC
    address private _owner;
    bool private _paused;
    uint256 private _reentrancyStatus;

    uint256 public perTxCap; // default: 5_000_000 (5 USDC)
    uint256 public dailyCap; // default: 20_000_000 (20 USDC)
    uint256 public missionCapDefault; // default: 10_000_000 (10 USDC)
    uint256 public policyVersion;

    mapping(address => bool) public recipientAllowlist;
    mapping(uint256 => uint256) public spentOnDay; // day (UTC) -> total spent
    mapping(bytes32 => uint256) public missionSpent; // missionId -> total treasury spent
    mapping(bytes32 => uint256) public missionToolCap; // missionId -> on-chain tool cap
    mapping(bytes32 => bool) public missionFunded; // missionId -> true if session wallet funded
    mapping(bytes32 => address) public missionSessionWallet; // missionId -> funded session wallet
    mapping(bytes32 => bytes32) public anchoredMissionProofs; // missionId -> anchored audit headHash

    struct Mission {
        bytes32 id; // keccak256(UTF8(slug))
        address agent; // single agent authorized to propose for this mission
        uint256 cap; // mission treasury cap
        uint256 expiresAt; // block.timestamp + duration
        bool exists;
        bool closed;
    }
    mapping(bytes32 => Mission) public missions;

    struct Proposal {
        uint256 id;
        address proposer; // must == missions[missionId].agent
        address to; // recipient (must full-match allowlist)
        uint256 amount; // USDC atomic units > 0
        bytes32 missionId; // must != 0, must exist
        string reason; // UTF-8 <= 200 bytes
        uint8 status; // 0=Proposed, 1=Queued, 2=Approved, 3=Executed, 4=Rejected, 5=Expired
        uint256 createdAt;
        uint256 expiresAt; // createdAt + 48 hours
        uint256 policyVersionAtPropose;
        bytes32 operationId; // nonzero unique in mission
        string queueReason; // OverPerTxCap / OverDailyCap / OverMissionCap
    }
    mapping(uint256 => Proposal) public proposals;
    mapping(bytes32 => mapping(bytes32 => uint256)) public proposalIdPlusOneByOperation;
    uint256 public nextProposalId;

    // --- Modifiers ---
    modifier onlyOwner() {
        require(msg.sender == _owner, "Ownable: caller is not the owner");
        _;
    }

    modifier whenNotPaused() {
        require(!_paused, "Pausable: paused");
        _;
    }

    modifier whenPaused() {
        require(_paused, "Pausable: not paused");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus != 2, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    // --- Constructor ---
    constructor(
        address _usdc,
        address _initialOwner,
        uint256 _perTxCap,
        uint256 _dailyCap,
        uint256 _missionCapDefault
    ) {
        require(_usdc != address(0) && _usdc.code.length > 0, "InvalidTokenAddress");
        require(_initialOwner != address(0), "InvalidOwnerAddress");
        USDC = _usdc;
        _owner = _initialOwner;
        perTxCap = _perTxCap > 0 ? _perTxCap : 5_000_000;
        dailyCap = _dailyCap > 0 ? _dailyCap : 20_000_000;
        missionCapDefault = _missionCapDefault > 0 ? _missionCapDefault : 10_000_000;
        policyVersion = 1;
        _reentrancyStatus = 1;
    }

    // --- Receive/Fallback Rejection (01 §1) ---
    receive() external payable {
        revert("DirectEtherNotAccepted");
    }

    fallback() external payable {
        revert("DirectEtherNotAccepted");
    }

    // --- View Functions ---
    function owner() public view returns (address) {
        return _owner;
    }

    function paused() public view returns (bool) {
        return _paused;
    }

    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days; // UTC day
    }

    function spentToday() external view returns (uint256) {
        return spentOnDay[currentDay()];
    }

    function proposalCount() external view returns (uint256) {
        return nextProposalId;
    }

    // --- Disabled Ownership Management (01 §1, C21) ---
    function transferOwnership(address /*newOwner*/) public pure {
        revert("OwnershipTransferDisabled");
    }

    function renounceOwnership() public pure {
        revert("OwnershipRenounceDisabled");
    }

    // --- Owner Policy & Mission Management ---
    function createMission(
        bytes32 missionId,
        address agent,
        uint256 cap,
        uint256 duration
    ) external onlyOwner {
        require(missionId != bytes32(0), "InvalidMissionId");
        require(!missions[missionId].exists, "MissionAlreadyExists");
        require(agent != address(0) && agent != _owner, "InvalidAgent");
        require(cap > 0, "InvalidCap");
        require(duration > 0, "InvalidDuration");

        uint256 expiresAt = block.timestamp + duration;
        missions[missionId] = Mission({
            id: missionId,
            agent: agent,
            cap: cap,
            expiresAt: expiresAt,
            exists: true,
            closed: false
        });

        policyVersion++;
        emit MissionCreated(missionId, agent, cap, expiresAt);
        emit PolicyVersionAdvanced(policyVersion);
    }

    function closeMission(bytes32 missionId) external onlyOwner {
        require(missions[missionId].exists, "MissionNotFound");
        require(!missions[missionId].closed, "MissionAlreadyClosed");

        missions[missionId].closed = true;
        policyVersion++;
        emit MissionClosed(missionId);
        emit PolicyVersionAdvanced(policyVersion);
    }

    function setMissionCap(bytes32 missionId, uint256 cap) external onlyOwner {
        require(missions[missionId].exists, "MissionNotFound");
        require(cap > 0, "InvalidCap");

        missions[missionId].cap = cap;
        policyVersion++;
        emit MissionCapUpdated(missionId, cap);
        emit PolicyVersionAdvanced(policyVersion);
    }

    function setCaps(uint256 _perTxCap, uint256 _dailyCap) external onlyOwner {
        require(_perTxCap > 0 && _dailyCap > 0, "InvalidCaps");
        perTxCap = _perTxCap;
        dailyCap = _dailyCap;
        policyVersion++;
        emit PolicyUpdated(policyVersion, _perTxCap, _dailyCap);
        emit PolicyVersionAdvanced(policyVersion);
    }

    function setRecipient(address r, bool allowed) external onlyOwner {
        require(r != address(0), "InvalidRecipient");
        recipientAllowlist[r] = allowed;
        policyVersion++;
        emit AllowlistUpdated(r, allowed);
        emit PolicyVersionAdvanced(policyVersion);
    }

    // --- Kill Switch / Emergency (01 §5) ---
    function pause() external onlyOwner {
        _paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        _paused = false;
        emit Unpaused(msg.sender);
    }

    function emergencyWithdraw() external onlyOwner whenPaused nonReentrant {
        uint256 balance = IERC20(USDC).balanceOf(address(this));
        require(balance > 0, "NoFunds");
        IERC20(USDC).safeTransfer(_owner, balance);
        emit EmergencyWithdrawn(balance);
    }

    // --- On-Chain Session Wallet Funding & Sweeping (P1-A, STRATEGY §4.3) ---
    function setMissionToolCap(bytes32 missionId, uint256 toolCap) external onlyOwner {
        require(missions[missionId].exists, "MissionNotFound");
        require(!missionFunded[missionId], "MissionAlreadyFunded");
        require(toolCap > 0, "InvalidToolCap");
        missionToolCap[missionId] = toolCap;
    }

    function fundMissionWallet(bytes32 missionId, address wallet, uint256 amount) public onlyOwner nonReentrant whenNotPaused {
        require(missions[missionId].exists, "MissionNotFound");
        require(!missions[missionId].closed, "MissionAlreadyClosed");
        require(block.timestamp < missions[missionId].expiresAt, "MissionExpired");
        require(!missionFunded[missionId], "MissionAlreadyFunded");
        require(wallet != address(0) && wallet != _owner && wallet != address(this), "InvalidWallet");
        require(amount > 0, "InvalidAmount");
        require(IERC20(USDC).balanceOf(address(this)) >= amount, "InsufficientTreasuryBalance");

        missionFunded[missionId] = true;
        missionSessionWallet[missionId] = wallet;
        missionToolCap[missionId] = amount;

        IERC20(USDC).safeTransfer(wallet, amount);
        emit MissionFunded(missionId, wallet, amount);
    }

    function fundMissionWallet(bytes32 missionId, address wallet) external onlyOwner {
        uint256 amount = missionToolCap[missionId] > 0 ? missionToolCap[missionId] : perTxCap;
        fundMissionWallet(missionId, wallet, amount);
    }

    function sweepMissionWallet(bytes32 missionId, uint256 amount) public onlyOwner nonReentrant {
        require(missions[missionId].exists, "MissionNotFound");
        require(missionFunded[missionId], "MissionNotFunded");
        address wallet = missionSessionWallet[missionId];
        require(wallet != address(0), "NoSessionWallet");
        require(amount > 0, "InvalidAmount");

        IERC20(USDC).safeTransferFrom(wallet, address(this), amount);
        emit MissionSwept(missionId, wallet, amount);
    }

    function sweepMissionWallet(bytes32 missionId) external onlyOwner {
        require(missions[missionId].exists, "MissionNotFound");
        require(missionFunded[missionId], "MissionNotFunded");
        address wallet = missionSessionWallet[missionId];
        require(wallet != address(0), "NoSessionWallet");
        uint256 remaining = IERC20(USDC).balanceOf(wallet);
        require(remaining > 0, "ZeroRemainingBalance");

        sweepMissionWallet(missionId, remaining);
    }

    // --- On-Chain Proof Anchoring (P1-B, STRATEGY §4.4) ---
    function anchorMissionProof(bytes32 missionId, bytes32 headHash) external onlyOwner {
        require(missions[missionId].exists, "MissionNotFound");
        require(headHash != bytes32(0), "InvalidHeadHash");

        anchoredMissionProofs[missionId] = headHash;
        emit MissionProofAnchored(missionId, headHash, block.timestamp);
    }

    // --- Core Propose Function (01 §4, §5) ---
    function propose(
        bytes32 operationId,
        address to,
        uint256 amount,
        bytes32 missionId,
        string calldata reason
    ) external nonReentrant returns (uint256 proposalId) {
        // Idempotency: operationId must be nonzero and unique in mission (01 §10, C19)
        require(operationId != bytes32(0), "InvalidOperationId");
        require(proposalIdPlusOneByOperation[missionId][operationId] == 0, "DuplicateOperation");

        // 4a. BLOCK checks - fail any => revert
        require(!_paused, "Paused");
        require(missionId != bytes32(0), "InvalidMissionId");

        Mission storage mission = missions[missionId];
        require(mission.exists, "InvalidMission");
        require(!mission.closed, "MissionClosed");
        require(block.timestamp < mission.expiresAt, "MissionExpired");
        require(msg.sender == mission.agent, "NotMissionAgent");

        require(to != address(0), "InvalidRecipient");
        require(to != mission.agent, "CannotPayAgent");
        require(amount > 0, "InvalidAmount");
        require(bytes(reason).length <= 200, "ReasonTooLong");
        require(recipientAllowlist[to], "NotAllowlisted");

        // 4b. QUEUE checks
        string memory queueReason = "";
        if (amount > perTxCap) {
            queueReason = "OverPerTxCap";
        } else if (spentOnDay[currentDay()] + amount > dailyCap) {
            queueReason = "OverDailyCap";
        } else if (missionSpent[missionId] + amount > mission.cap) {
            queueReason = "OverMissionCap";
        }

        proposalId = nextProposalId++;
        proposalIdPlusOneByOperation[missionId][operationId] = proposalId + 1;

        if (bytes(queueReason).length > 0) {
            // QUEUE branch
            proposals[proposalId] = Proposal({
                id: proposalId,
                proposer: msg.sender,
                to: to,
                amount: amount,
                missionId: missionId,
                reason: reason,
                status: 1, // Queued
                createdAt: block.timestamp,
                expiresAt: block.timestamp + 48 hours,
                policyVersionAtPropose: policyVersion,
                operationId: operationId,
                queueReason: queueReason
            });

            emit Proposed(proposalId, msg.sender, to, amount, missionId, operationId);
            emit Queued(proposalId, to, amount, queueReason);
            return proposalId;
        }

        // EXECUTE branch (Auto payout in propose)
        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            to: to,
            amount: amount,
            missionId: missionId,
            reason: reason,
            status: 3, // Executed
            createdAt: block.timestamp,
            expiresAt: block.timestamp + 48 hours,
            policyVersionAtPropose: policyVersion,
            operationId: operationId,
            queueReason: ""
        });

        // CEI: update state before external transfer
        spentOnDay[currentDay()] += amount;
        missionSpent[missionId] += amount;

        emit Proposed(proposalId, msg.sender, to, amount, missionId, operationId);
        IERC20(USDC).safeTransfer(to, amount);
        emit Executed(proposalId, to, amount, missionId);

        return proposalId;
    }

    // --- Owner Queue Resolution ---
    function approve(uint256 proposalId) external onlyOwner whenNotPaused {
        Proposal storage p = proposals[proposalId];
        require(p.status == 1, "NotQueued");
        require(block.timestamp <= p.expiresAt, "ProposalExpired");

        // Hard checks
        Mission storage m = missions[p.missionId];
        require(m.exists && !m.closed && block.timestamp < m.expiresAt, "MissionInvalidOrExpired");
        require(recipientAllowlist[p.to], "RecipientNotAllowlisted");
        require(p.to != m.agent, "CannotPayAgent");

        p.status = 2; // Approved
        emit Approved(proposalId);
    }

    function execute(uint256 proposalId) external onlyOwner whenNotPaused nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.status == 2, "NotApproved");
        require(block.timestamp <= p.expiresAt, "ProposalExpired");

        // Hard re-checks (01 §5, §6)
        Mission storage m = missions[p.missionId];
        require(m.exists && !m.closed && block.timestamp < m.expiresAt, "MissionInvalidOrExpired");
        require(recipientAllowlist[p.to], "RecipientNotAllowlisted");
        require(p.to != m.agent, "CannotPayAgent");

        // Soft caps are deliberate owner override; do not re-check soft caps
        p.status = 3; // Executed

        spentOnDay[currentDay()] += p.amount;
        missionSpent[p.missionId] += p.amount;

        IERC20(USDC).safeTransfer(p.to, p.amount);
        emit Executed(proposalId, p.to, p.amount, p.missionId);
    }

    function reject(uint256 proposalId, string calldata reason) external onlyOwner {
        Proposal storage p = proposals[proposalId];
        require(p.status == 1 || p.status == 2, "NotQueuedOrApproved");

        p.status = 4; // Rejected
        emit Rejected(proposalId, reason);
    }

    function expire(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.status == 1 || p.status == 2, "NotQueuedOrApproved");
        require(block.timestamp > p.expiresAt, "NotYetExpired");

        p.status = 5; // Expired
        emit Expired(proposalId);
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }
}
