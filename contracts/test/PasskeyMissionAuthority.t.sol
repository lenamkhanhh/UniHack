// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/PasskeyMissionAuthority.sol";
import "../src/GuardedTreasury.sol";
import "./GuardedTreasury.t.sol";

contract MockP256Precompile {
    uint256 internal constant SECP256R1_N =
        0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant SECP256R1_HALF_N = SECP256R1_N / 2;

    fallback(bytes calldata input) external returns (bytes memory) {
        if (input.length != 160) {
            return "";
        }

        // input format: hash (32), r (32), s (32), x (32), y (32)
        uint256 r = uint256(bytes32(input[32:64]));
        uint256 s = uint256(bytes32(input[64:96]));
        uint256 x = uint256(bytes32(input[96:128]));
        uint256 y = uint256(bytes32(input[128:160]));

        // Check basic validity
        if (r == 0 || r >= SECP256R1_N || s == 0 || s > SECP256R1_HALF_N || x == 0 || y == 0) {
            return "";
        }

        // Return 1 for valid verification
        return abi.encode(uint256(1));
    }
}

contract PasskeyMissionAuthorityTest is Test {
    PasskeyMissionAuthority public authority;
    GuardedTreasury public treasury;
    MockUSDC public usdc;

    uint256 internal passkeyPrivKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
    uint256 internal passkeyX;
    uint256 internal passkeyY;

    address internal relayer = address(0x9999);
    address internal agent = address(0x1111);
    address internal attacker = address(0x6666);
    bytes32 internal missionId = keccak256("test_passkey_mission");
    bytes32 internal payeeRoot = keccak256("payee_root_1");
    uint256 internal cap = 10_000_000;
    uint256 internal duration = 30 days;
    uint256 internal toolCap = 1_000_000;

    address internal constant PRECOMPILE = address(0x0000000000000000000000000000000000000100);

    function vm_expectRevertString(string memory reason) internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("expectRevert(bytes)", abi.encodeWithSignature("Error(string)", reason)));
        require(success, "vm.expectRevert failed");
    }

    function vm_expectAnyRevert() internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("expectRevert()"));
        require(success, "vm.expectRevert failed");
    }

    function vm_etch(address target, bytes memory code) internal {
        (bool success, ) = VM_ADDRESS.call(abi.encodeWithSignature("etch(address,bytes)", target, code));
        require(success, "vm.etch failed");
    }

    function vm_signP256(uint256 privateKey, bytes32 digest) internal returns (bytes32 r, bytes32 s) {
        (bool success, bytes memory ret) = VM_ADDRESS.call(
            abi.encodeWithSignature("signP256(uint256,bytes32)", privateKey, digest)
        );
        require(success, "vm.signP256 failed");
        return abi.decode(ret, (bytes32, bytes32));
    }

    function vm_publicKeyP256(uint256 privateKey) internal returns (bytes32 x, bytes32 y) {
        (bool success, bytes memory ret) = VM_ADDRESS.call(
            abi.encodeWithSignature("publicKeyP256(uint256)", privateKey)
        );
        require(success, "vm.publicKeyP256 failed");
        return abi.decode(ret, (bytes32, bytes32));
    }

    function vm_getNonce(address target) internal returns (uint64) {
        (bool success, bytes memory ret) = VM_ADDRESS.call(abi.encodeWithSignature("getNonce(address)", target));
        require(success, "vm.getNonce failed");
        return abi.decode(ret, (uint64));
    }

    function computeCreateAddress(address deployer, uint8 nonce) internal pure returns (address) {
        bytes memory data = abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, nonce);
        return address(uint160(uint256(keccak256(data))));
    }

    function setUp() public {
        (bytes32 qx, bytes32 qy) = vm_publicKeyP256(passkeyPrivKey);
        passkeyX = uint256(qx);
        passkeyY = uint256(qy);

        usdc = new MockUSDC();

        // 1. Etch mock P-256 precompile if running in local EVM (not forked)
        if (PRECOMPILE.code.length == 0) {
            MockP256Precompile mockPrecompile = new MockP256Precompile();
            vm_etch(PRECOMPILE, address(mockPrecompile).code);
        }

        uint64 nonce = vm_getNonce(address(this));
        // treasury will be deployed at nonce, authority will be deployed at nonce + 1
        address predictedAuthority = computeCreateAddress(address(this), uint8(nonce + 1));

        treasury = new GuardedTreasury(
            address(usdc),
            predictedAuthority,
            5_000_000,
            20_000_000,
            cap
        );

        authority = new PasskeyMissionAuthority(
            address(treasury),
            passkeyX,
            passkeyY
        );

        require(address(authority) == predictedAuthority, "AuthorityAddressMismatch");
    }

    function _buildWebAuthnAuth(
        bytes32 challenge,
        uint256 privKey,
        uint8 flagByte
    ) internal returns (PasskeyMissionAuthority.WebAuthnAuth memory) {
        bytes memory authenticatorData = new bytes(37);
        for (uint256 i = 0; i < 32; i++) {
            authenticatorData[i] = bytes1(uint8(i + 1));
        }
        authenticatorData[32] = bytes1(flagByte); // UP / UV flags
        authenticatorData[33] = 0x00;
        authenticatorData[34] = 0x00;
        authenticatorData[35] = 0x00;
        authenticatorData[36] = 0x01; // signCount = 1

        bytes memory challengeB64 = authority.encodeBase64Url32(challenge);
        string memory clientDataJSON = string(
            abi.encodePacked(
                '{"type":"webauthn.get","challenge":"',
                string(challengeB64),
                '","origin":"http://localhost:3100"}'
            )
        );

        uint256 typeIndex = 8; // start of "webauthn.get" in clientDataJSON
        uint256 challengeIndex = 36; // start of challenge in clientDataJSON

        bytes32 clientDataHash = sha256(bytes(clientDataJSON));
        bytes32 messageHash = sha256(abi.encodePacked(authenticatorData, clientDataHash));

        (bytes32 r, bytes32 s) = vm_signP256(privKey, messageHash);

        uint256 secp256r1N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
        uint256 sInt = uint256(s);
        if (sInt > secp256r1N / 2) {
            sInt = secp256r1N - sInt;
        }

        return PasskeyMissionAuthority.WebAuthnAuth({
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON,
            challengeIndex: challengeIndex,
            typeIndex: typeIndex,
            r: uint256(r),
            s: sInt
        });
    }

    function test_approveMission_happyPath() public {
        uint256 nonce = authority.nextNonce();
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-v1",
                block.chainid,
                address(authority),
                missionId,
                agent,
                payeeRoot,
                cap,
                duration,
                toolCap,
                nonce
            )
        );

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x01);

        vm_prank(relayer);
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);

        (
            bytes32 mId,
            address mAgent,
            uint256 mCap,
            uint256 expiresAt,
            bool exists,
            bool closed
        ) = treasury.missions(missionId);

        assertTrue(exists);
        assertFalse(closed);
        assertEq(mId, missionId);
        assertEq(mAgent, agent);
        assertEq(mCap, cap);
        assertEq(expiresAt, block.timestamp + duration);
        assertEq(treasury.missionPayeeRoot(missionId), payeeRoot);
        assertEq(treasury.missionToolCap(missionId), toolCap);
        assertEq(authority.nextNonce(), 1);
    }

    function test_approveMission_replayNonce_reverts() public {
        uint256 nonce = authority.nextNonce();
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-v1",
                block.chainid,
                address(authority),
                missionId,
                agent,
                payeeRoot,
                cap,
                duration,
                toolCap,
                nonce
            )
        );

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x01);

        vm_prank(relayer);
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);

        vm_prank(relayer);
        vm_expectRevertString("InvalidNonce");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_approveMission_wrongChallenge_reverts() public {
        uint256 nonce = authority.nextNonce();
        bytes32 corruptedChallenge = keccak256("corrupted_challenge");

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(corruptedChallenge, passkeyPrivKey, 0x01);

        vm_prank(relayer);
        vm_expectRevertString("ChallengeMismatch");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_approveMission_missingUserPresence_reverts() public {
        uint256 nonce = authority.nextNonce();
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-v1",
                block.chainid,
                address(authority),
                missionId,
                agent,
                payeeRoot,
                cap,
                duration,
                toolCap,
                nonce
            )
        );

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x00);

        vm_prank(relayer);
        vm_expectRevertString("UserPresenceRequired");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_rotatePasskey_happyPath() public {
        uint256 newPrivKey = 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890;
        (bytes32 nqx, bytes32 nqy) = vm_publicKeyP256(newPrivKey);
        uint256 newX = uint256(nqx);
        uint256 newY = uint256(nqy);

        uint256 nonce = authority.nextNonce();
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-rotate-v1",
                block.chainid,
                address(authority),
                newX,
                newY,
                nonce
            )
        );

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x01);

        authority.rotatePasskey(newX, newY, nonce, auth);

        assertEq(authority.passkeyX(), newX);
        assertEq(authority.passkeyY(), newY);
    }

    function test_anyCaller_canRelay_with_validSignature() public {
        uint256 nonce = authority.nextNonce();
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-v1",
                block.chainid,
                address(authority),
                missionId,
                agent,
                payeeRoot,
                cap,
                duration,
                toolCap,
                nonce
            )
        );

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x01);

        address randomUntrustedRelayer = address(0x5555);
        vm_prank(randomUntrustedRelayer);
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);

        (, , , , bool exists, ) = treasury.missions(missionId);
        assertTrue(exists);
    }

    function testFork_approveMission_on_Fuji_precompile() public {
        uint256 nonce = authority.nextNonce();
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-v1",
                block.chainid,
                address(authority),
                missionId,
                agent,
                payeeRoot,
                cap,
                duration,
                toolCap,
                nonce
            )
        );

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x01);

        vm_prank(relayer);
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);

        (, address mAgent, , , bool exists, ) = treasury.missions(missionId);
        assertTrue(exists);
        assertEq(mAgent, agent);
    }
}
