// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/GuardedTreasury.sol";

// Minimal forge-std Script interface with cheat codes
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

    function vm_etch(address target, bytes memory code) internal {
        (bool success, ) = VM_ADDRESS.call(
            abi.encodeWithSignature("etch(address,bytes)", target, code)
        );
        require(success, "etch failed");
    }
}

contract DeployGuardedTreasury is Script {
    // Avalanche Fuji USDC address (00 §6)
    address public constant FUJI_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;

    // Caps from 00 §6
    uint256 public constant PER_TX_CAP = 5_000_000; // 5 USDC
    uint256 public constant DAILY_CAP = 20_000_000; // 20 USDC
    uint256 public constant MISSION_CAP_DEFAULT = 10_000_000; // 10 USDC

    // Well-known Anvil/Hardhat private keys that are strictly prohibited on live networks
    uint256 private constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 private constant ANVIL_KEY_1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    event DeploymentSimulated(
        address indexed treasuryAddress,
        address indexed owner,
        address indexed usdcAddress,
        string verifyCommand
    );

    function run() external returns (GuardedTreasury treasury) {
        uint256 deployerKey = vm_envOr("DEPLOYER_PRIVATE_KEY", 0);

        // Security check (KEY-02): Reject insecure Anvil keys
        if (deployerKey != 0) {
            require(
                deployerKey != ANVIL_KEY_0 && deployerKey != ANVIL_KEY_1,
                "KEY-02: INSECURE_ANVIL_KEY_PROHIBITED_ON_FUJI"
            );
        }

        address deployer = msg.sender;

        // In local simulation where Fuji USDC contract is not present, etch mock bytecode
        if (FUJI_USDC.code.length == 0) {
            vm_etch(FUJI_USDC, hex"00");
        }

        // Dry-run simulation (no broadcast to live network without explicit authorization)
        treasury = new GuardedTreasury(
            FUJI_USDC,
            deployer,
            PER_TX_CAP,
            DAILY_CAP,
            MISSION_CAP_DEFAULT
        );

        emit DeploymentSimulated(
            address(treasury),
            deployer,
            FUJI_USDC,
            "forge verify-contract <TREASURY_ADDRESS> src/GuardedTreasury.sol:GuardedTreasury --chain-id 43113 --verifier-url https://api-testnet.snowtrace.io/api --watch"
        );
    }
}
