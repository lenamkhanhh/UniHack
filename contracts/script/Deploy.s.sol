// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/GuardedTreasury.sol";

// Minimal forge-std Script interface
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
}

contract DeployGuardedTreasury is Script {
    // Avalanche Fuji USDC address (00 §6)
    address public constant FUJI_USDC = 0x5425890298aed601595a70AB815c96711a31Bc65;

    // Caps from 00 §6
    uint256 public constant PER_TX_CAP = 5_000_000; // 5 USDC
    uint256 public constant DAILY_CAP = 20_000_000; // 20 USDC
    uint256 public constant MISSION_CAP_DEFAULT = 10_000_000; // 10 USDC

    function run() external returns (GuardedTreasury treasury) {
        address deployer = msg.sender;

        vm_startBroadcast();
        treasury = new GuardedTreasury(
            FUJI_USDC,
            deployer,
            PER_TX_CAP,
            DAILY_CAP,
            MISSION_CAP_DEFAULT
        );
        vm_stopBroadcast();
    }
}
