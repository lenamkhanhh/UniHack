// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/MissionBudgetHub.sol";
import "../src/MissionSpendGateway.sol";
import "../src/teleporter/ITeleporterMessenger.sol";

interface IERC20Token {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

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

library AvalancheNetworkConstants {
    address public constant TELEPORTER_MESSENGER = 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf;
    address public constant WARP_PRECOMPILE = 0x0200000000000000000000000000000000000005;
    address public constant FUJI_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;

    // Verified live Avalanche blockchain IDs from Warp Precompile / Teleporter
    bytes32 public constant FUJI_BLOCKCHAIN_ID = 0x7fc93d85c6d62c5b2ac0b519c87010ea5294012d1e407030d6acd0021cac10d5;
    bytes32 public constant DISPATCH_BLOCKCHAIN_ID = 0x9f3be606497285d0ffbb5ac9ba24aa60346a9b1812479ed66cb329f394a4b1c7;
}

/**
 * @title DeployFujiHub
 * @notice Phase (a): Deploys MissionBudgetHub on Avalanche Fuji C-Chain.
 * Reads Fuji blockchain ID dynamically from Warp precompile 0x0200...0005.
 * Strictly checks non-zero Dispatch and Fuji blockchain IDs.
 */
contract DeployFujiHub is Script {
    function run() external returns (MissionBudgetHub hub) {
        // Read current chain ID from Warp precompile
        bytes32 currentChainBlockchainID;
        if (AvalancheNetworkConstants.WARP_PRECOMPILE.code.length > 0) {
            try IWarpMessenger(AvalancheNetworkConstants.WARP_PRECOMPILE).getBlockchainID() returns (bytes32 id) {
                currentChainBlockchainID = id;
            } catch {}
        }
        if (currentChainBlockchainID == bytes32(0)) {
            currentChainBlockchainID = AvalancheNetworkConstants.FUJI_BLOCKCHAIN_ID;
        }

        bytes32 dispatchBlockchainID = vm_envOr(
            "DISPATCH_BLOCKCHAIN_ID",
            AvalancheNetworkConstants.DISPATCH_BLOCKCHAIN_ID
        );

        require(currentChainBlockchainID != bytes32(0), "InvalidFujiBlockchainID");
        require(dispatchBlockchainID != bytes32(0), "InvalidDispatchBlockchainID");

        address paymentToken = vm_envOr("PAYMENT_TOKEN_OVERRIDE", AvalancheNetworkConstants.FUJI_USDC);
        address messenger = vm_envOr("TELEPORTER_MESSENGER_OVERRIDE", AvalancheNetworkConstants.TELEPORTER_MESSENGER);

        vm_startBroadcast();
        hub = new MissionBudgetHub(
            messenger,
            dispatchBlockchainID,
            address(0), // allowedOriginSender set in Phase (c)
            paymentToken
        );
        vm_stopBroadcast();
    }
}

/**
 * @title DeployDispatchGateway
 * @notice Phase (b): Deploys MissionSpendGateway on Avalanche Dispatch L1.
 * Reads Dispatch blockchain ID dynamically from Warp precompile 0x0200...0005.
 * Points to the deployed Fuji MissionBudgetHub address.
 */
contract DeployDispatchGateway is Script {
    function run() external returns (MissionSpendGateway gateway) {
        // Read current chain ID from Warp precompile
        bytes32 currentChainBlockchainID;
        if (AvalancheNetworkConstants.WARP_PRECOMPILE.code.length > 0) {
            try IWarpMessenger(AvalancheNetworkConstants.WARP_PRECOMPILE).getBlockchainID() returns (bytes32 id) {
                currentChainBlockchainID = id;
            } catch {}
        }
        if (currentChainBlockchainID == bytes32(0)) {
            currentChainBlockchainID = AvalancheNetworkConstants.DISPATCH_BLOCKCHAIN_ID;
        }

        bytes32 fujiBlockchainID = vm_envOr(
            "FUJI_BLOCKCHAIN_ID",
            AvalancheNetworkConstants.FUJI_BLOCKCHAIN_ID
        );

        require(currentChainBlockchainID != bytes32(0), "InvalidDispatchBlockchainID");
        require(fujiBlockchainID != bytes32(0), "InvalidFujiBlockchainID");

        // Destination Hub on Fuji (from env or placeholder for simulation)
        address hubAddress = vm_envOr("FUJI_BUDGET_HUB_ADDRESS", address(0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496));
        address messenger = vm_envOr("TELEPORTER_MESSENGER_OVERRIDE", AvalancheNetworkConstants.TELEPORTER_MESSENGER);

        vm_startBroadcast();
        gateway = new MissionSpendGateway(
            messenger,
            fujiBlockchainID,
            hubAddress
        );
        vm_stopBroadcast();
    }
}

/**
 * @title ConfigureFujiHub
 * @notice Phase (c): Links Gateway origin on Hub, registers mission with cap <= 1 USDC,
 * and funds hub with <= 1 USDC.
 */
contract ConfigureFujiHub is Script {
    function run() external {
        address hubAddress = vm_envOr("FUJI_BUDGET_HUB_ADDRESS", address(0x7FA9385bE102ac3EAc297483Dd6233D62b3e1496));
        address gatewayAddress = vm_envOr("DISPATCH_GATEWAY_ADDRESS", address(0x34A1D3fff3958843C43aD80F30b94c510645C316));
        address agent = vm_envOr("MISSION_AGENT_ADDRESS", address(0x374b8A126FDb9e5deEc8307da385076155Af3D72));

        bytes32 dispatchBlockchainID = vm_envOr(
            "DISPATCH_BLOCKCHAIN_ID",
            AvalancheNetworkConstants.DISPATCH_BLOCKCHAIN_ID
        );

        bytes32 missionId = keccak256("mission.dispatch.live.01");
        // Sample standard owner-signed root for vendor payee
        bytes32 payeeRoot = 0xc6ce8ae383124b268df66d71f0af2206e6dafb13eba0b03806eed8a4e7991329;
        uint256 cap = 1_000_000; // 1 USDC cap (strictly <= 1 USDC)

        vm_startBroadcast();
        MissionBudgetHub hub = MissionBudgetHub(hubAddress);
        hub.setAllowedOrigin(dispatchBlockchainID, gatewayAddress);
        hub.registerMission(missionId, agent, payeeRoot, cap);

        // Fund hub with 1.00 USDC if balance is available
        IERC20Token usdc = IERC20Token(AvalancheNetworkConstants.FUJI_USDC);
        if (usdc.balanceOf(msg.sender) >= cap) {
            usdc.transfer(hubAddress, cap);
        }
        vm_stopBroadcast();
    }
}
