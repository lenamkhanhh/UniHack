// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/erc8004/ValidationRegistry.sol";

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
}

contract DeployValidationRegistry is Script {
    address public constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    uint256 private constant ANVIL_KEY_0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 private constant ANVIL_KEY_1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    function run() external returns (ValidationRegistry registry) {
        uint256 deployerKey = vm_envOr("DEPLOYER_PRIVATE_KEY", 0);

        if (deployerKey != 0) {
            require(
                deployerKey != ANVIL_KEY_0 && deployerKey != ANVIL_KEY_1,
                "KEY-02: INSECURE_ANVIL_KEY_PROHIBITED_ON_FUJI"
            );
        }

        vm_startBroadcast();
        registry = new ValidationRegistry(IDENTITY_REGISTRY);
        vm_stopBroadcast();
    }
}
