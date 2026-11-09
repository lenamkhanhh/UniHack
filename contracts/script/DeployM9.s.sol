// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/MissionBudgetHub.sol";
import "../src/MissionSpendGateway.sol";
import "../src/teleporter/ITeleporterMessenger.sol";

abstract contract Script {
    address internal constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));

    function vm_startBroadcast() internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("startBroadcast()"));
        require(success, "startBroadcast failed");
    }

    function vm_stopBroadcast() internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("stopBroadcast()"));
        require(success, "stopBroadcast failed");
    }

    function vm_envOr(string memory name, uint256 defaultValue) internal returns (uint256) {
        (bool success, bytes memory ret) = VM_ADDRESS.call(
            abi.encodeWithSignature("envOr(string,uint256)", name, defaultValue)
        );
        if (success && ret.length >= 32) {
            return abi.decode(ret, (uint256));
        }
        return defaultValue;
    }

    function vm_envOr(string memory name, address defaultValue) internal returns (address) {
        (bool success, bytes memory ret) = VM_ADDRESS.call(
            abi.encodeWithSignature("envOr(string,address)", name, defaultValue)
        );
        if (success && ret.length >= 32) {
            return abi.decode(ret, (address));
        }
        return defaultValue;
    }

    function vm_envOr(string memory name, bytes32 defaultValue) internal returns (bytes32) {
        (bool success, bytes memory ret) = VM_ADDRESS.call(
            abi.encodeWithSignature("envOr(string,bytes32)", name, defaultValue)
        );
        if (success && ret.length >= 32) {
            return abi.decode(ret, (bytes32));
        }
        return defaultValue;
    }
}

/**
 * @title DeployM9
 * @notice Forge deployment script for M9: Avalanche Cross-L1 Mission Budgeting.
 * Deploys MissionBudgetHub on Fuji C-Chain and MissionSpendGateway on Dispatch L1.
 * Dynamically resolves blockchain IDs via env or Teleporter getBlockchainID().
 * DRY-RUN ONLY until Dispatch gas faucet is funded by Owner.
 */
contract DeployM9 is Script {
    // Official pre-deployed TeleporterMessenger on both Fuji and Dispatch
    address public constant TELEPORTER_MESSENGER = 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf;
    // Fuji USDC address
    address public constant FUJI_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;

    event M9ContractsSimulated(
        address indexed budgetHubFuji,
        address indexed spendGatewayDispatch,
        bytes32 fujiBlockchainID,
        bytes32 dispatchBlockchainID
    );

    function run() external returns (MissionBudgetHub hub, MissionSpendGateway gateway) {
        // Blockchain IDs: Read from env or dynamically query teleporter messenger
        bytes32 defaultDispatchId = bytes32(uint256(779672));
        bytes32 defaultFujiId = bytes32(uint256(43113));

        bytes32 dispatchBlockchainID = vm_envOr("DISPATCH_BLOCKCHAIN_ID", defaultDispatchId);
        bytes32 fujiBlockchainID = vm_envOr("FUJI_BLOCKCHAIN_ID", defaultFujiId);

        // If messenger contract exists on this chain, attempt dynamic query
        if (TELEPORTER_MESSENGER.code.length > 0) {
            try ITeleporterMessenger(TELEPORTER_MESSENGER).getBlockchainID() returns (bytes32 bId) {
                if (bId != bytes32(0)) {
                    if (block.chainid == 43113) {
                        fujiBlockchainID = bId;
                    } else if (block.chainid == 779672) {
                        dispatchBlockchainID = bId;
                    }
                }
            } catch {}
        }

        address messenger = vm_envOr("TELEPORTER_MESSENGER_OVERRIDE", TELEPORTER_MESSENGER);
        address paymentToken = vm_envOr("PAYMENT_TOKEN_OVERRIDE", FUJI_USDC);

        vm_startBroadcast();

        // 1. Deploy MissionBudgetHub on Fuji (cross-L1 budget hub separate from GuardedTreasury)
        hub = new MissionBudgetHub(
            messenger,
            dispatchBlockchainID,
            address(0), // Linked below
            paymentToken
        );

        // 2. Deploy MissionSpendGateway on Dispatch L1
        gateway = new MissionSpendGateway(
            messenger,
            fujiBlockchainID,
            address(hub)
        );

        // 3. Link Gateway address on Hub
        hub.setAllowedOrigin(dispatchBlockchainID, address(gateway));

        vm_stopBroadcast();

        emit M9ContractsSimulated(
            address(hub),
            address(gateway),
            fujiBlockchainID,
            dispatchBlockchainID
        );
    }
}
