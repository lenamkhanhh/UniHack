// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../src/teleporter/ITeleporterMessenger.sol";

/**
 * @title MockTeleporterMessenger
 * @notice Mock implementation of Avalanche TeleporterMessenger for local testing.
 * Records messages and allows simulating cross-chain delivery.
 */
contract MockTeleporterMessenger is ITeleporterMessenger {
    struct SentMessage {
        bytes32 destinationBlockchainID;
        address destinationAddress;
        address sender;
        bytes message;
    }

    SentMessage[] public sentMessages;
    uint256 public nextMessageID = 1;
    bool public autoRelay;
    bytes32 public currentSourceBlockchainID;

    event CrossChainMessageSent(
        uint256 indexed messageID,
        bytes32 indexed destinationBlockchainID,
        address indexed destinationAddress,
        bytes message
    );

    constructor(bytes32 _sourceBlockchainID, bool _autoRelay) {
        currentSourceBlockchainID = _sourceBlockchainID;
        autoRelay = _autoRelay;
    }

    function setAutoRelay(bool _autoRelay) external {
        autoRelay = _autoRelay;
    }

    function setSourceBlockchainID(bytes32 _sourceBlockchainID) external {
        currentSourceBlockchainID = _sourceBlockchainID;
    }

    function getBlockchainID() external view override returns (bytes32) {
        return currentSourceBlockchainID;
    }

    function sendCrossChainMessage(
        TeleporterMessageInput calldata messageInput
    ) external override returns (uint256) {
        uint256 messageID = nextMessageID++;
        sentMessages.push(
            SentMessage({
                destinationBlockchainID: messageInput.destinationBlockchainID,
                destinationAddress: messageInput.destinationAddress,
                sender: msg.sender,
                message: messageInput.message
            })
        );

        emit CrossChainMessageSent(
            messageID,
            messageInput.destinationBlockchainID,
            messageInput.destinationAddress,
            messageInput.message
        );

        if (autoRelay) {
            ITeleporterReceiver(messageInput.destinationAddress)
                .receiveTeleporterMessage(
                    currentSourceBlockchainID,
                    msg.sender,
                    messageInput.message
                );
        }

        return messageID;
    }

    function getSentMessageCount() external view returns (uint256) {
        return sentMessages.length;
    }

    function relayMessage(
        uint256 index,
        bytes32 originBlockchainID,
        address originSender
    ) external {
        SentMessage memory m = sentMessages[index];
        ITeleporterReceiver(m.destinationAddress).receiveTeleporterMessage(
            originBlockchainID,
            originSender,
            m.message
        );
    }
}
