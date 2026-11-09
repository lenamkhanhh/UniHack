// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./teleporter/ITeleporterMessenger.sol";

/**
 * @title MissionSpendGateway
 * @notice Cross-chain gateway contract deployed on Avalanche L1 (e.g. Dispatch).
 * Allows agents to initiate cross-chain payout requests to MissionBudgetHub on Fuji C-Chain
 * via Avalanche Interchain Messaging (Teleporter/ICM).
 */
contract MissionSpendGateway {
    ITeleporterMessenger public immutable teleporterMessenger;
    bytes32 public destinationBlockchainID;
    address public destinationBudgetHub;
    address public owner;
    uint256 public nextNonce = 1;

    event SpendRequestSent(
        bytes32 indexed messageId,
        bytes32 indexed missionId,
        address indexed agent,
        address payee,
        uint256 amount,
        uint256 teleporterMessageID
    );

    event DestinationUpdated(
        bytes32 destinationBlockchainID,
        address destinationBudgetHub
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "OnlyOwner");
        _;
    }

    constructor(
        address _teleporterMessenger,
        bytes32 _destinationBlockchainID,
        address _destinationBudgetHub
    ) {
        require(_teleporterMessenger != address(0), "InvalidMessenger");
        teleporterMessenger = ITeleporterMessenger(_teleporterMessenger);
        destinationBlockchainID = _destinationBlockchainID;
        destinationBudgetHub = _destinationBudgetHub;
        owner = msg.sender;
    }

    function setDestination(
        bytes32 _destinationBlockchainID,
        address _destinationBudgetHub
    ) external onlyOwner {
        destinationBlockchainID = _destinationBlockchainID;
        destinationBudgetHub = _destinationBudgetHub;
        emit DestinationUpdated(_destinationBlockchainID, _destinationBudgetHub);
    }

    /**
     * @notice Sends a cross-chain spend proposal to the Fuji MissionBudgetHub.
     * @param missionId Target mission identifier.
     * @param payee Intended payment recipient address.
     * @param amount Payout amount (e.g. atomic USDC units).
     * @param proof Merkle proof confirming payee is in owner's mission root.
     * @return messageId Deterministically derived unique message identifier (M9-F4).
     * @return teleporterMessageID Teleporter receipt ID from messenger.
     */
    function sendSpendRequest(
        bytes32 missionId,
        address payee,
        uint256 amount,
        bytes32[] calldata proof
    ) external returns (bytes32 messageId, uint256 teleporterMessageID) {
        require(missionId != bytes32(0), "InvalidMissionId");
        require(payee != address(0), "InvalidPayee");
        require(amount > 0, "InvalidAmount");
        require(destinationBudgetHub != address(0), "DestinationNotSet");

        // M9-F4: Derive deterministic unique message ID using chainid, contract, and sequential nonce
        messageId = keccak256(
            abi.encode(block.chainid, address(this), nextNonce++)
        );

        // M9-F1: Embed msg.sender (calling agent) into payload so Hub enforces agent authorization
        bytes memory messageData = abi.encode(
            messageId,
            missionId,
            msg.sender,
            payee,
            amount,
            proof
        );

        ITeleporterMessenger.TeleporterMessageInput memory input = ITeleporterMessenger
            .TeleporterMessageInput({
                destinationBlockchainID: destinationBlockchainID,
                destinationAddress: destinationBudgetHub,
                feeInfo: ITeleporterMessenger.TeleporterFeeInfo({
                    feeTokenAddress: address(0),
                    amount: 0
                }),
                requiredGasLimit: 250000,
                allowedRelayers: new address[](0),
                message: messageData
            });

        teleporterMessageID = teleporterMessenger.sendCrossChainMessage(input);

        emit SpendRequestSent(
            messageId,
            missionId,
            msg.sender,
            payee,
            amount,
            teleporterMessageID
        );

        return (messageId, teleporterMessageID);
    }
}
