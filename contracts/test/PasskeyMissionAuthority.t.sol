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

    bytes32 internal defaultRpIdHash = sha256(bytes("localhost"));
    string internal defaultOrigin = "http://localhost:3100";
    bool internal defaultRequireUV = true;

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

    function _indexOf(bytes memory haystack, bytes memory needle) internal pure returns (uint256) {
        if (needle.length == 0 || needle.length > haystack.length) return type(uint256).max;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return i;
        }
        return type(uint256).max;
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
            passkeyY,
            defaultRpIdHash,
            defaultOrigin,
            defaultRequireUV
        );

        require(address(authority) == predictedAuthority, "AuthorityAddressMismatch");
    }

    struct CustomAuthParams {
        bytes32 challenge;
        uint256 privKey;
        bytes32 rpIdHashVal;
        uint8 flagByte;
        string typeVal;
        string originVal;
        bool addCrossOriginTrue;
        bool forceHighS;
    }

    function _makeAuthenticatorData(bytes32 rpIdHashVal, uint8 flagByte) internal pure returns (bytes memory) {
        bytes memory authData = new bytes(37);
        for (uint256 i = 0; i < 32; i++) {
            authData[i] = rpIdHashVal[i];
        }
        authData[32] = bytes1(flagByte);
        authData[36] = 0x01;
        return authData;
    }

    function _makeClientDataJSON(
        bytes memory challengeB64,
        string memory typeVal,
        string memory originVal,
        bool addCrossOriginTrue
    ) internal pure returns (string memory) {
        if (addCrossOriginTrue) {
            return string(
                abi.encodePacked(
                    '{"type":"', typeVal,
                    '","challenge":"', string(challengeB64),
                    '","origin":"', originVal,
                    '","crossOrigin":true}'
                )
            );
        }
        return string(
            abi.encodePacked(
                '{"type":"', typeVal,
                '","challenge":"', string(challengeB64),
                '","origin":"', originVal,
                '"}'
            )
        );
    }

    function _buildCustomAuth(CustomAuthParams memory p) internal returns (PasskeyMissionAuthority.WebAuthnAuth memory) {
        bytes memory authenticatorData = _makeAuthenticatorData(p.rpIdHashVal, p.flagByte);
        bytes memory challengeB64 = authority.encodeBase64Url32(p.challenge);
        string memory clientDataJSON = _makeClientDataJSON(challengeB64, p.typeVal, p.originVal, p.addCrossOriginTrue);

        bytes memory clientBytes = bytes(clientDataJSON);
        bytes memory typeNeedle = abi.encodePacked('"type":"', p.typeVal, '"');
        bytes memory challengeNeedle = abi.encodePacked('"challenge":"', string(challengeB64), '"');
        bytes memory originNeedle = abi.encodePacked('"origin":"', p.originVal, '"');

        bytes32 messageHash = sha256(abi.encodePacked(authenticatorData, sha256(clientBytes)));
        (bytes32 r, bytes32 s) = vm_signP256(p.privKey, messageHash);

        uint256 secp256r1N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
        uint256 sInt = uint256(s);
        if (p.forceHighS) {
            if (sInt <= secp256r1N / 2) {
                sInt = secp256r1N - sInt;
            }
        } else {
            if (sInt > secp256r1N / 2) {
                sInt = secp256r1N - sInt;
            }
        }

        return PasskeyMissionAuthority.WebAuthnAuth({
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON,
            challengeIndex: _indexOf(clientBytes, challengeNeedle),
            typeIndex: _indexOf(clientBytes, typeNeedle),
            originIndex: _indexOf(clientBytes, originNeedle),
            r: uint256(r),
            s: sInt
        });
    }

    function _buildWebAuthnAuth(
        bytes32 challenge,
        uint256 privKey,
        uint8 flagByte
    ) internal returns (PasskeyMissionAuthority.WebAuthnAuth memory) {
        return _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: privKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: flagByte,
            typeVal: "webauthn.get",
            originVal: defaultOrigin,
            addCrossOriginTrue: false,
            forceHighS: false
        }));
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

        // Flag 0x05 = User Present (0x01) + User Verified (0x04)
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x05);

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

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x05);

        vm_prank(relayer);
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);

        vm_prank(relayer);
        vm_expectRevertString("InvalidNonce");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function _buildWrongFieldWebAuthnAuth(
        bytes32 challenge,
        uint256 privKey
    ) internal returns (PasskeyMissionAuthority.WebAuthnAuth memory) {
        bytes memory authenticatorData = _makeAuthenticatorData(defaultRpIdHash, 0x05);
        bytes memory challengeB64 = authority.encodeBase64Url32(challenge);
        string memory clientDataJSON = string(
            abi.encodePacked(
                '{"type":"webauthn.get","other_field":"',
                string(challengeB64),
                '","origin":"http://localhost:3100"}'
            )
        );

        bytes memory clientBytes = bytes(clientDataJSON);
        bytes32 messageHash = sha256(abi.encodePacked(authenticatorData, sha256(clientBytes)));
        (bytes32 r, bytes32 s) = vm_signP256(privKey, messageHash);

        return PasskeyMissionAuthority.WebAuthnAuth({
            authenticatorData: authenticatorData,
            clientDataJSON: clientDataJSON,
            challengeIndex: 23,
            typeIndex: 1,
            originIndex: _indexOf(clientBytes, bytes('"origin":"http://localhost:3100"')),
            r: uint256(r),
            s: uint256(s)
        });
    }

    function test_approveMission_wrongChallenge_reverts() public {
        uint256 nonce = authority.nextNonce();
        bytes32 corruptedChallenge = keccak256("corrupted_challenge");

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(corruptedChallenge, passkeyPrivKey, 0x05);

        vm_prank(relayer);
        vm_expectRevertString("ChallengeMismatch");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_approveMission_challengeInWrongField_reverts() public {
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

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWrongFieldWebAuthnAuth(challenge, passkeyPrivKey);

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

        // Flag 0x04 = UV only without UP (bit 0 is 0)
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x04);

        vm_prank(relayer);
        vm_expectRevertString("UserPresenceRequired");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    // ==========================================
    // 8 SPECIFIC TESTS FOR PK-F1 HARDENING
    // ==========================================

    function test_wrongRpIdHash_reverts() public {
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

        bytes32 wrongRpIdHash = sha256(bytes("attacker-phishing.com"));
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: wrongRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.get",
            originVal: defaultOrigin,
            addCrossOriginTrue: false,
            forceHighS: false
        }));

        vm_prank(relayer);
        vm_expectRevertString("InvalidRpIdHash");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_phishingOrigin_reverts() public {
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

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.get",
            originVal: "https://phishing-missionpay.com",
            addCrossOriginTrue: false,
            forceHighS: false
        }));

        vm_prank(relayer);
        vm_expectRevertString("OriginMismatch");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_originPrefixTrick_reverts() public {
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

        // Attacker attempts subdomain prefix bypass trick
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.get",
            originVal: "http://localhost:3100.evil.com",
            addCrossOriginTrue: false,
            forceHighS: false
        }));

        vm_prank(relayer);
        vm_expectRevertString("OriginMismatch");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_userPresentWithoutVerification_reverts() public {
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

        // UP (0x01) without UV (0x04) -> flag 0x01
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x01,
            typeVal: "webauthn.get",
            originVal: defaultOrigin,
            addCrossOriginTrue: false,
            forceHighS: false
        }));

        vm_prank(relayer);
        vm_expectRevertString("UserVerificationRequired");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_registrationCeremonyAsAssertion_reverts() public {
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

        // Type "webauthn.create" instead of "webauthn.get"
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.create",
            originVal: defaultOrigin,
            addCrossOriginTrue: false,
            forceHighS: false
        }));

        vm_prank(relayer);
        vm_expectRevertString("InvalidWebAuthnType");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_highS_reverts() public {
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

        // Force s > N / 2 (high-S malleability)
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.get",
            originVal: defaultOrigin,
            addCrossOriginTrue: false,
            forceHighS: true
        }));

        vm_prank(relayer);
        vm_expectRevertString("InvalidSignatureS");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_crossOriginTrue_reverts() public {
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

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.get",
            originVal: defaultOrigin,
            addCrossOriginTrue: true,
            forceHighS: false
        }));

        vm_prank(relayer);
        vm_expectRevertString("CrossOriginNotAllowed");
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);
    }

    function test_rotatePasskey_requiresSameChecks() public {
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

        // Case 1: Wrong RP ID hash in rotation assertion
        bytes32 wrongRpIdHash = sha256(bytes("attacker-phishing.com"));
        PasskeyMissionAuthority.WebAuthnAuth memory badAuthRp = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: wrongRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.get",
            originVal: defaultOrigin,
            addCrossOriginTrue: false,
            forceHighS: false
        }));
        vm_expectRevertString("InvalidRpIdHash");
        authority.rotatePasskey(newX, newY, nonce, badAuthRp);

        // Case 2: Phishing origin in rotation assertion
        PasskeyMissionAuthority.WebAuthnAuth memory badAuthOrigin = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x05,
            typeVal: "webauthn.get",
            originVal: "https://phishing.evil",
            addCrossOriginTrue: false,
            forceHighS: false
        }));
        vm_expectRevertString("OriginMismatch");
        authority.rotatePasskey(newX, newY, nonce, badAuthOrigin);

        // Case 3: Missing UV in rotation assertion
        PasskeyMissionAuthority.WebAuthnAuth memory badAuthUV = _buildCustomAuth(CustomAuthParams({
            challenge: challenge,
            privKey: passkeyPrivKey,
            rpIdHashVal: defaultRpIdHash,
            flagByte: 0x01, // UP only
            typeVal: "webauthn.get",
            originVal: defaultOrigin,
            addCrossOriginTrue: false,
            forceHighS: false
        }));
        vm_expectRevertString("UserVerificationRequired");
        authority.rotatePasskey(newX, newY, nonce, badAuthUV);

        // Case 4: Happy path rotation
        PasskeyMissionAuthority.WebAuthnAuth memory validAuth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x05);
        authority.rotatePasskey(newX, newY, nonce, validAuth);

        assertEq(authority.passkeyX(), newX);
        assertEq(authority.passkeyY(), newY);
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

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x05);

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

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x05);

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

        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(challenge, passkeyPrivKey, 0x05);

        vm_prank(relayer);
        authority.approveMission(missionId, agent, payeeRoot, cap, duration, toolCap, nonce, auth);

        (, address mAgent, , , bool exists, ) = treasury.missions(missionId);
        assertTrue(exists);
        assertEq(mAgent, agent);
    }
}
