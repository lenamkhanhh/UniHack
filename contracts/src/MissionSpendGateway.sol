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

    event SpendRequestSent(
        bytes32 indexed messageId,
        bytes32 indexed missionId,
        address indexed payee,
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
     * @param messageId Unique identifier for this spend message (used for replay protection).
     * @param missionId Target mission identifier.
     * @param payee Intended payment recipient address.
     * @param amount Payout amount (e.g. atomic USDC units).
     * @param proof Merkle proof confirming payee is in owner's mission root.
     */
    function sendSpendRequest(
        bytes32 messageId,
        bytes32 missionId,
        address payee,
        uint256 amount,
        bytes32[] calldata proof
    ) external returns (uint256 teleporterMessageID) {
        require(messageId != bytes32(0), "InvalidMessageId");
        require(missionId != bytes32(0), "InvalidMissionId");
        require(payee != address(0), "InvalidPayee");
        require(amount > 0, "InvalidAmount");
        require(destinationBudgetHub != address(0), "DestinationNotSet");

        bytes memory messageData = abi.encode(
            messageId,
            missionId,
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
            payee,
            amount,
            teleporterMessageID
        );
    }
}
