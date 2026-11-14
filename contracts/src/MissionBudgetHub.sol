// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./teleporter/ITeleporterMessenger.sol";

interface IERC20Hub {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title MissionBudgetHub
 * @notice Cross-L1 budget hub deployed on Avalanche Fuji C-Chain (separate from GuardedTreasury).
 * Receives cross-chain spend requests from MissionSpendGateway (e.g. on Dispatch L1) via Teleporter/ICM.
 * Strictly verifies source chain ID, origin gateway address, caller agent authorization (M9-F1),
 * message replay, Merkle payee root proof (M9-F2), and remaining mission cap before releasing funds (M9-F3).
 */
contract MissionBudgetHub is ITeleporterReceiver {
    ITeleporterMessenger public immutable teleporterMessenger;
    bytes32 public allowedSourceBlockchainID;
    address public allowedOriginSender;
    address public owner;
    IERC20Hub public immutable paymentToken;

    struct MissionBudget {
        address agent;
        bytes32 payeeRoot;
        uint256 cap;
        uint256 spent;
        bool exists;
        bool closed;
    }

    mapping(bytes32 => MissionBudget) public missions;
    mapping(bytes32 => bool) public executedMessages;

    event MissionRegistered(
        bytes32 indexed missionId,
        address indexed agent,
        bytes32 payeeRoot,
        uint256 cap
    );

    event MissionClosed(bytes32 indexed missionId);

    event SpendExecuted(
        bytes32 indexed messageId,
        bytes32 indexed missionId,
        address indexed agent,
        address payee,
        uint256 amount
    );

    event AllowedOriginUpdated(
        bytes32 allowedSourceBlockchainID,
        address allowedOriginSender
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "OnlyOwner");
        _;
    }

    constructor(
        address _teleporterMessenger,
        bytes32 _allowedSourceBlockchainID,
        address _allowedOriginSender,
        address _paymentToken
    ) {
        require(_teleporterMessenger != address(0), "InvalidMessenger");
        require(_paymentToken != address(0), "InvalidPaymentToken"); // M9-F3
        teleporterMessenger = ITeleporterMessenger(_teleporterMessenger);
        allowedSourceBlockchainID = _allowedSourceBlockchainID;
        allowedOriginSender = _allowedOriginSender;
        paymentToken = IERC20Hub(_paymentToken);
        owner = msg.sender;
    }

    function setAllowedOrigin(
        bytes32 _sourceBlockchainID,
        address _originSender
    ) external onlyOwner {
        allowedSourceBlockchainID = _sourceBlockchainID;
        allowedOriginSender = _originSender;
        emit AllowedOriginUpdated(_sourceBlockchainID, _originSender);
    }

    function registerMission(
        bytes32 missionId,
        address agent,
        bytes32 payeeRoot,
        uint256 cap
    ) external onlyOwner {
        require(missionId != bytes32(0), "InvalidMissionId");
        require(agent != address(0), "InvalidAgent"); // M9-F1
        require(payeeRoot != bytes32(0), "InvalidPayeeRoot"); // M9-F2
        require(cap > 0, "InvalidCap");
        require(!missions[missionId].exists, "MissionAlreadyExists");

        missions[missionId] = MissionBudget({
            agent: agent,
            payeeRoot: payeeRoot,
            cap: cap,
            spent: 0,
            exists: true,
            closed: false
        });

        emit MissionRegistered(missionId, agent, payeeRoot, cap);
    }

    function closeMission(bytes32 missionId) external onlyOwner {
        require(missions[missionId].exists, "MissionNotFound");
        missions[missionId].closed = true;
        emit MissionClosed(missionId);
    }

    /**
     * @notice Handles incoming Avalanche ICM messages from Teleporter.
     * @param originBlockchainID The blockchain ID where the message originated.
     * @param originSenderAddress The contract address on the source chain that sent the message.
     * @param message ABI-encoded spend request payload.
     */
    function receiveTeleporterMessage(
        bytes32 originBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) external override {
        // 1. Messenger authority check
        require(
            msg.sender == address(teleporterMessenger),
            "UnauthorizedMessenger"
        );

        // 2. Source chain verification
        require(
            originBlockchainID == allowedSourceBlockchainID,
            "WrongSourceChain"
        );

        // 3. Origin gateway address verification
        require(
            originSenderAddress == allowedOriginSender,
            "WrongOriginSender"
        );

        // 4. Decode payload including agent address (M9-F1)
        (
            bytes32 messageId,
            bytes32 missionId,
            address agent,
            address payee,
            uint256 amount,
            bytes32[] memory proof
        ) = abi.decode(
                message,
                (bytes32, bytes32, address, address, uint256, bytes32[])
            );

        // 5. Replay guard
        require(!executedMessages[messageId], "MessageAlreadyExecuted");

        // 6. Mission existence and active status
        MissionBudget storage mission = missions[missionId];
        require(mission.exists, "MissionNotFound");
        require(!mission.closed, "MissionClosed");

        // M9-F1: Verify calling agent matches the registered mission agent
        require(agent == mission.agent, "UnauthorizedAgent");

        // 7. Cap check
        require(mission.spent + amount <= mission.cap, "OverCap");

        // M9-F2: Always verify Merkle payee proof against non-zero payeeRoot
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(payee))));
        require(_verifyMerkle(proof, mission.payeeRoot, leaf), "PayeeNotInMissionSet");

        // 8. State updates (checks-effects)
        executedMessages[messageId] = true;
        mission.spent += amount;

        // M9-F3: Strictly transfer payment token
        require(paymentToken.transfer(payee, amount), "TransferFailed");

        emit SpendExecuted(messageId, missionId, agent, payee, amount);
    }

    /**
     * @dev Internal Merkle proof verification matching OpenZeppelin StandardMerkleTree.
     */
    function _verifyMerkle(
        bytes32[] memory proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(
                    abi.encodePacked(computedHash, proofElement)
                );
            } else {
                computedHash = keccak256(
                    abi.encodePacked(proofElement, computedHash)
                );
            }
        }
        return computedHash == root;
    }
}
