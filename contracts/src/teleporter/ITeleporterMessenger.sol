// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title ITeleporterMessenger
 * @notice Standard interface for the Avalanche Teleporter (ICM) Messenger contract.
 * Reference: https://github.com/ava-labs/teleporter
 */
interface ITeleporterMessenger {
    struct TeleporterFeeInfo {
        address feeTokenAddress;
        uint256 amount;
    }

    struct TeleporterMessageInput {
        bytes32 destinationBlockchainID;
        address destinationAddress;
        TeleporterFeeInfo feeInfo;
        uint256 requiredGasLimit;
        address[] allowedRelayers;
        bytes message;
    }

    function sendCrossChainMessage(
        TeleporterMessageInput calldata messageInput
    ) external returns (uint256);
}

/**
 * @title ITeleporterReceiver
 * @notice Standard interface that must be implemented by cross-chain message recipients.
 */
interface ITeleporterReceiver {
    function receiveTeleporterMessage(
        bytes32 originBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) external;
}
