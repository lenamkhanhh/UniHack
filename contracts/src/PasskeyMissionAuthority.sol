// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IGuardedTreasuryAuthority {
    function createMission(
        bytes32 missionId,
        address agent,
        uint256 cap,
        uint256 duration
    ) external;

    function setMissionPayeeRoot(bytes32 missionId, bytes32 root) external;

    function setMissionCap(bytes32 missionId, uint256 cap) external;

    function setMissionToolCap(bytes32 missionId, uint256 toolCap) external;
}

/**
 * @title PasskeyMissionAuthority
 * @notice WebAuthn P-256 passkey mission authority utilizing Avalanche RIP-7212 P-256 precompile (0x100).
 * Allows owners to create and authorize missions using biometric credentials (Face ID, Touch ID, Windows Hello)
 * without holding an EOA private key on their client device.
 */
contract PasskeyMissionAuthority {
    // secp256r1 curve order n
    uint256 internal constant SECP256R1_N =
        0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant SECP256R1_HALF_N = SECP256R1_N / 2;

    address public constant PRECOMPILE_P256 = address(0x0000000000000000000000000000000000000100);

    bytes internal constant TABLE_B64URL =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    struct WebAuthnAuth {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        uint256 r;
        uint256 s;
    }

    address public immutable treasury;
    uint256 public passkeyX;
    uint256 public passkeyY;
    uint256 public nextNonce;

    event MissionApprovedByPasskey(
        bytes32 indexed missionId,
        address indexed agent,
        bytes32 payeeRoot,
        uint256 cap,
        uint256 duration,
        uint256 toolCap,
        uint256 nonce
    );

    event PasskeyRotated(uint256 oldX, uint256 oldY, uint256 newX, uint256 newY, uint256 nonce);

    constructor(address _treasury, uint256 _passkeyX, uint256 _passkeyY) {
        require(_treasury != address(0), "InvalidTreasury");
        require(_passkeyX != 0 && _passkeyY != 0, "InvalidPasskeyCoordinates");
        treasury = _treasury;
        passkeyX = _passkeyX;
        passkeyY = _passkeyY;
    }

    /**
     * @notice Approves and creates a mission on GuardedTreasury authenticated via WebAuthn passkey assertion.
     * @param missionId Unique mission identifier
     * @param agent Autonomous agent address assigned to the mission
     * @param payeeRoot Merkle root of owner-authorized payee set
     * @param cap Maximum payout cap for the mission in token atomic units
     * @param duration Mission lifetime in seconds
     * @param toolCap Maximum budget allocated for session wallet tool execution
     * @param nonce Sequential nonce protecting against replay attacks
     * @param auth WebAuthn assertion data signed by the owner's passkey
     */
    function approveMission(
        bytes32 missionId,
        address agent,
        bytes32 payeeRoot,
        uint256 cap,
        uint256 duration,
        uint256 toolCap,
        uint256 nonce,
        WebAuthnAuth calldata auth
    ) external {
        require(nonce == nextNonce, "InvalidNonce");
        nextNonce++;

        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-v1",
                block.chainid,
                address(this),
                missionId,
                agent,
                payeeRoot,
                cap,
                duration,
                toolCap,
                nonce
            )
        );

        _verifyWebAuthn(challenge, auth, passkeyX, passkeyY);

        // Execute administrative actions on the owned GuardedTreasury
        IGuardedTreasuryAuthority(treasury).createMission(missionId, agent, cap, duration);
        IGuardedTreasuryAuthority(treasury).setMissionPayeeRoot(missionId, payeeRoot);
        if (toolCap > 0) {
            IGuardedTreasuryAuthority(treasury).setMissionToolCap(missionId, toolCap);
        }

        emit MissionApprovedByPasskey(missionId, agent, payeeRoot, cap, duration, toolCap, nonce);
    }

    /**
     * @notice Rotates the registered passkey coordinates, authenticated by the current passkey.
     */
    function rotatePasskey(
        uint256 newX,
        uint256 newY,
        uint256 nonce,
        WebAuthnAuth calldata auth
    ) external {
        require(nonce == nextNonce, "InvalidNonce");
        require(newX != 0 && newY != 0, "InvalidNewCoordinates");
        nextNonce++;

        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-rotate-v1",
                block.chainid,
                address(this),
                newX,
                newY,
                nonce
            )
        );

        _verifyWebAuthn(challenge, auth, passkeyX, passkeyY);

        uint256 oldX = passkeyX;
        uint256 oldY = passkeyY;
        passkeyX = newX;
        passkeyY = newY;

        emit PasskeyRotated(oldX, oldY, newX, newY, nonce);
    }

    /**
     * @dev Internal WebAuthn signature validator invoking Avalanche RIP-7212 precompile.
     */
    function _verifyWebAuthn(
        bytes32 challenge,
        WebAuthnAuth calldata auth,
        uint256 qx,
        uint256 qy
    ) internal view {
        // 1. Check authenticatorData length (must be >= 37 bytes)
        require(auth.authenticatorData.length >= 37, "InvalidAuthenticatorDataLength");

        // 2. Check User Present (UP) flag (bit 0 of flags byte at index 32)
        require((uint8(auth.authenticatorData[32]) & 0x01) != 0, "UserPresenceRequired");

        // 3. Verify type in clientDataJSON matches '"type":"webauthn.get"' (W4-F3)
        bytes memory clientBytes = bytes(auth.clientDataJSON);
        bytes memory expectedType = bytes('"type":"webauthn.get"');
        require(
            auth.typeIndex + expectedType.length <= clientBytes.length,
            "TypeIndexOutOfBounds"
        );
        require(
            _matchesSubsequence(clientBytes, auth.typeIndex, expectedType),
            "InvalidWebAuthnType"
        );

        // 4. Verify challenge in clientDataJSON matches '"challenge":"' + base64url(challenge) + '"' (W4-F3)
        bytes memory expectedChallengeB64 = encodeBase64Url32(challenge);
        bytes memory expectedChallengePattern = abi.encodePacked('"challenge":"', string(expectedChallengeB64), '"');
        require(
            auth.challengeIndex + expectedChallengePattern.length <= clientBytes.length,
            "ChallengeIndexOutOfBounds"
        );
        require(
            _matchesSubsequence(clientBytes, auth.challengeIndex, expectedChallengePattern),
            "ChallengeMismatch"
        );

        // 5. Enforce malleability protection (low-s)
        require(auth.s > 0 && auth.s <= SECP256R1_HALF_N, "InvalidSignatureS");
        require(auth.r > 0 && auth.r < SECP256R1_N, "InvalidSignatureR");

        // 6. Compute WebAuthn verification message: authenticatorData || sha256(clientDataJSON)
        bytes32 clientDataHash = sha256(clientBytes);
        bytes32 messageHash = sha256(abi.encodePacked(auth.authenticatorData, clientDataHash));

        // 7. Invoke RIP-7212 precompile at 0x100
        bytes memory input = abi.encodePacked(messageHash, auth.r, auth.s, qx, qy);
        (bool success, bytes memory output) = PRECOMPILE_P256.staticcall(input);
        require(success && output.length == 32 && abi.decode(output, (uint256)) == 1, "P256VerificationFailed");
    }

    function _matchesSubsequence(
        bytes memory data,
        uint256 startIndex,
        bytes memory pattern
    ) internal pure returns (bool) {
        if (startIndex + pattern.length > data.length) return false;
        for (uint256 i = 0; i < pattern.length; i++) {
            if (data[startIndex + i] != pattern[i]) {
                return false;
            }
        }
        return true;
    }

    function encodeBase64Url32(bytes32 data) public pure returns (bytes memory) {
        bytes memory result = new bytes(43);
        bytes memory raw = abi.encodePacked(data);

        uint256 rIdx = 0;
        for (uint256 i = 0; i < 30; i += 3) {
            uint256 b0 = uint8(raw[i]);
            uint256 b1 = uint8(raw[i + 1]);
            uint256 b2 = uint8(raw[i + 2]);

            result[rIdx++] = TABLE_B64URL[(b0 >> 2) & 0x3F];
            result[rIdx++] = TABLE_B64URL[((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0F)];
            result[rIdx++] = TABLE_B64URL[((b1 & 0x0F) << 2) | ((b2 >> 6) & 0x03)];
            result[rIdx++] = TABLE_B64URL[b2 & 0x3F];
        }

        uint256 lastB0 = uint8(raw[30]);
        uint256 lastB1 = uint8(raw[31]);

        result[rIdx++] = TABLE_B64URL[(lastB0 >> 2) & 0x3F];
        result[rIdx++] = TABLE_B64URL[((lastB0 & 0x03) << 4) | ((lastB1 >> 4) & 0x0F)];
        result[rIdx++] = TABLE_B64URL[(lastB1 & 0x0F) << 2];

        return result;
    }
}
