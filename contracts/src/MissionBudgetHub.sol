// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./teleporter/ITeleporterMessenger.sol";

interface IERC20Hub {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title MissionBudgetHub
 * @notice Central mission budgeting contract deployed on Avalanche Fuji C-Chain.
 * Receives cross-chain spend requests from MissionSpendGateway (e.g. on Dispatch L1) via Teleporter/ICM.
 * Strictly verifies source chain ID, origin gateway address, message replay,
 * Merkle payee root proof, and remaining mission cap before releasing funds.
 */
contract MissionBudgetHub is ITeleporterReceiver {
    ITeleporterMessenger public immutable teleporterMessenger;
    bytes32 public allowedSourceBlockchainID;
    address public allowedOriginSender;
    address public owner;
    IERC20Hub public paymentToken;

    struct MissionBudget {
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
        bytes32 payeeRoot,
        uint256 cap
    );

    event MissionClosed(bytes32 indexed missionId);

    event SpendExecuted(
        bytes32 indexed messageId,
        bytes32 indexed missionId,
        address indexed payee,
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

    function setPaymentToken(address _paymentToken) external onlyOwner {
        paymentToken = IERC20Hub(_paymentToken);
    }

    function registerMission(
        bytes32 missionId,
        bytes32 payeeRoot,
        uint256 cap
    ) external onlyOwner {
        require(missionId != bytes32(0), "InvalidMissionId");
        require(cap > 0, "InvalidCap");
        require(!missions[missionId].exists, "MissionAlreadyExists");

        missions[missionId] = MissionBudget({
            payeeRoot: payeeRoot,
            cap: cap,
            spent: 0,
            exists: true,
            closed: false
        });

        emit MissionRegistered(missionId, payeeRoot, cap);
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

        // 4. Decode payload
        (
            bytes32 messageId,
            bytes32 missionId,
            address payee,
            uint256 amount,
            bytes32[] memory proof
        ) = abi.decode(message, (bytes32, bytes32, address, uint256, bytes32[]));

        // 5. Replay guard
        require(!executedMessages[messageId], "MessageAlreadyExecuted");

        // 6. Mission existence and active status
        MissionBudget storage mission = missions[missionId];
        require(mission.exists, "MissionNotFound");
        require(!mission.closed, "MissionClosed");

        // 7. Cap check
        require(mission.spent + amount <= mission.cap, "OverCap");

        // 8. Merkle payee proof verification (Double-hash standard OpenZeppelin leaf)
        bytes32 root = mission.payeeRoot;
        if (root != bytes32(0)) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(payee))));
            require(_verifyMerkle(proof, root, leaf), "PayeeNotInMissionSet");
        }

        // 9. State updates (checks-effects)
        executedMessages[messageId] = true;
        mission.spent += amount;

        // 10. Release funds (if token configured and funded)
        if (address(paymentToken) != address(0)) {
            require(paymentToken.transfer(payee, amount), "TransferFailed");
        }

        emit SpendExecuted(messageId, missionId, payee, amount);
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
