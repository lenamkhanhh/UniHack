// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IGuardedTreasuryAuthority {
    function USDC() external view returns (address);

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

interface IERC20Token {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

/**
 * @title PasskeyMissionAuthority
 * @notice WebAuthn P-256 passkey mission authority utilizing Avalanche RIP-7212 P-256 precompile (0x100).
 * Allows owners to create and authorize missions and manage their owned GuardedTreasury using biometric
 * credentials (Face ID, Touch ID, Windows Hello) without holding an EOA private key on their client device.
 * Hardened with RP ID hash, strict origin validation, User Verification enforcement, crossOrigin rejection,
 * high-S malleability protection, and strict allowlisted governance selectors on immutable treasury.
 */
contract PasskeyMissionAuthority {
    // secp256r1 curve order n
    uint256 internal constant SECP256R1_N =
        0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant SECP256R1_HALF_N = SECP256R1_N / 2;

    address public constant PRECOMPILE_P256 = address(0x0000000000000000000000000000000000000100);

    bytes internal constant TABLE_B64URL =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    // Allowlisted GuardedTreasury selectors (A3 Specification)
    bytes4 internal constant SELECTOR_SET_RECIPIENT = bytes4(keccak256("setRecipient(address,bool)"));
    bytes4 internal constant SELECTOR_FUND_WALLET_AMOUNT = bytes4(keccak256("fundMissionWallet(bytes32,address,uint256)"));
    bytes4 internal constant SELECTOR_FUND_WALLET_DEFAULT = bytes4(keccak256("fundMissionWallet(bytes32,address)"));
    bytes4 internal constant SELECTOR_PAUSE = bytes4(keccak256("pause()"));
    bytes4 internal constant SELECTOR_UNPAUSE = bytes4(keccak256("unpause()"));
    bytes4 internal constant SELECTOR_APPROVE = bytes4(keccak256("approve(uint256)"));
    bytes4 internal constant SELECTOR_EXECUTE = bytes4(keccak256("execute(uint256)"));
    bytes4 internal constant SELECTOR_REJECT = bytes4(keccak256("reject(uint256,string)"));
    bytes4 internal constant SELECTOR_CLOSE_MISSION = bytes4(keccak256("closeMission(bytes32)"));
    bytes4 internal constant SELECTOR_SET_MISSION_CAP = bytes4(keccak256("setMissionCap(bytes32,uint256)"));
    bytes4 internal constant SELECTOR_SET_MISSION_TOOL_CAP = bytes4(keccak256("setMissionToolCap(bytes32,uint256)"));
    bytes4 internal constant SELECTOR_SET_CAPS = bytes4(keccak256("setCaps(uint256,uint256)"));
    bytes4 internal constant SELECTOR_SET_MISSION_PAYEE_ROOT = bytes4(keccak256("setMissionPayeeRoot(bytes32,bytes32)"));
    bytes4 internal constant SELECTOR_ANCHOR_MISSION_PROOF = bytes4(keccak256("anchorMissionProof(bytes32,bytes32)"));
    bytes4 internal constant SELECTOR_EMERGENCY_WITHDRAW = bytes4(keccak256("emergencyWithdraw()"));
    bytes4 internal constant SELECTOR_SWEEP_WALLET = bytes4(keccak256("sweepMissionWalletWithAuthorization(bytes32,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)"));
    bytes4 internal constant SELECTOR_CREATE_MISSION = bytes4(keccak256("createMission(bytes32,address,uint256,uint256)"));

    struct WebAuthnAuth {
        bytes authenticatorData;
        string clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        uint256 originIndex;
        uint256 r;
        uint256 s;
    }

    address public immutable treasury;
    uint256 public passkeyX;
    uint256 public passkeyY;
    uint256 public nextNonce;

    bytes32 public immutable rpIdHash;
    string public expectedOrigin;
    bool public immutable requireUserVerification;

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
    event OwnerActionExecuted(bytes4 indexed selector, bytes callData, uint256 nonce);
    event TokensWithdrawnByPasskey(address indexed to, uint256 amount, uint256 nonce);

    constructor(
        address _treasury,
        uint256 _passkeyX,
        uint256 _passkeyY,
        bytes32 _rpIdHash,
        string memory _expectedOrigin,
        bool _requireUserVerification
    ) {
        require(_treasury != address(0), "InvalidTreasury");
        require(_passkeyX != 0 && _passkeyY != 0, "InvalidPasskeyCoordinates");
        require(_rpIdHash != bytes32(0), "InvalidRpIdHashParameter");
        require(bytes(_expectedOrigin).length > 0, "InvalidExpectedOrigin");
        treasury = _treasury;
        passkeyX = _passkeyX;
        passkeyY = _passkeyY;
        rpIdHash = _rpIdHash;
        expectedOrigin = _expectedOrigin;
        requireUserVerification = _requireUserVerification;
    }

    /**
     * @notice Checks whether a given function selector is permitted for owner governance action.
     */
    function isAllowedTreasurySelector(bytes4 selector) public pure returns (bool) {
        return selector == SELECTOR_SET_RECIPIENT ||
               selector == SELECTOR_FUND_WALLET_AMOUNT ||
               selector == SELECTOR_FUND_WALLET_DEFAULT ||
               selector == SELECTOR_PAUSE ||
               selector == SELECTOR_UNPAUSE ||
               selector == SELECTOR_APPROVE ||
               selector == SELECTOR_EXECUTE ||
               selector == SELECTOR_REJECT ||
               selector == SELECTOR_CLOSE_MISSION ||
               selector == SELECTOR_SET_MISSION_CAP ||
               selector == SELECTOR_SET_MISSION_TOOL_CAP ||
               selector == SELECTOR_SET_CAPS ||
               selector == SELECTOR_SET_MISSION_PAYEE_ROOT ||
               selector == SELECTOR_ANCHOR_MISSION_PROOF ||
               selector == SELECTOR_EMERGENCY_WITHDRAW ||
               selector == SELECTOR_SWEEP_WALLET ||
               selector == SELECTOR_CREATE_MISSION;
    }

    /**
     * @notice Approves and creates a mission on GuardedTreasury authenticated via WebAuthn passkey assertion.
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

    function _computeOwnerActionChallenge(bytes calldata callData, uint256 nonce) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                "MissionPay-passkey-owner-action-v1",
                block.chainid,
                address(this),
                treasury,
                keccak256(callData),
                nonce
            )
        );
    }

    function _computeWithdrawChallenge(address usdcToken, address to, uint256 amount, uint256 nonce) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                "MissionPay-passkey-withdraw-v1",
                block.chainid,
                address(this),
                usdcToken,
                to,
                amount,
                nonce
            )
        );
    }

    /**
     * @notice Executes an owner governance action on the owned GuardedTreasury with WebAuthn passkey assertion (A3).
     * @param callData Exact encoded calldata targeting GuardedTreasury
     * @param nonce Sequential nonce protecting against replay attacks
     * @param auth WebAuthn assertion data signed by the owner's passkey
     */
    function executeOwnerAction(
        bytes calldata callData,
        uint256 nonce,
        WebAuthnAuth calldata auth
    ) external {
        require(nonce == nextNonce, "InvalidNonce");
        require(callData.length >= 4, "InvalidCallDataLength");

        bytes4 selector = bytes4(callData[:4]);
        require(isAllowedTreasurySelector(selector), "SelectorNotAllowed");

        nextNonce++;

        _verifyWebAuthn(_computeOwnerActionChallenge(callData, nonce), auth, passkeyX, passkeyY);

        _callTreasury(callData);

        emit OwnerActionExecuted(selector, callData, nonce);
    }

    function _callTreasury(bytes calldata callData) internal {
        (bool success, ) = treasury.call(callData);
        require(success, "TreasuryActionFailed");
    }

    /**
     * @notice Withdraws recovered tokens from this contract to an owner-specified address (A3).
     * Used when emergencyWithdraw() sends tokens to this authority contract.
     * @param to Destination address authorized by the owner
     * @param amount Token amount to transfer
     * @param nonce Sequential nonce
     * @param auth WebAuthn assertion data signed by the owner's passkey
     */
    function withdrawTokens(
        address to,
        uint256 amount,
        uint256 nonce,
        WebAuthnAuth calldata auth
    ) external {
        require(nonce == nextNonce, "InvalidNonce");
        require(to != address(0) && to != address(this), "InvalidRecipient");
        require(amount > 0, "InvalidAmount");

        nextNonce++;

        address usdcToken = IGuardedTreasuryAuthority(treasury).USDC();
        require(IERC20Token(usdcToken).balanceOf(address(this)) >= amount, "InsufficientBalance");

        _verifyWebAuthn(_computeWithdrawChallenge(usdcToken, to, amount, nonce), auth, passkeyX, passkeyY);

        _safeTransferToken(usdcToken, to, amount);

        emit TokensWithdrawnByPasskey(to, amount, nonce);
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

        // 2. Check RP ID hash in authenticatorData[0:32] matches rpIdHash
        require(bytes32(auth.authenticatorData[:32]) == rpIdHash, "InvalidRpIdHash");

        // 3. Check User Present (UP) flag (bit 0 of flags byte at index 32)
        require((uint8(auth.authenticatorData[32]) & 0x01) != 0, "UserPresenceRequired");

        // 4. Check User Verification (UV) flag (bit 2 of flags byte at index 32) when required
        if (requireUserVerification) {
            require((uint8(auth.authenticatorData[32]) & 0x04) != 0, "UserVerificationRequired");
        }

        // 5. Verify type in clientDataJSON matches '"type":"webauthn.get"'
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

        // 6. Verify challenge in clientDataJSON matches '"challenge":"' + base64url(challenge) + '"'
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

        // 7. Verify origin in clientDataJSON matches '"origin":"' + expectedOrigin + '"' (closing quote prevents prefix trick)
        bytes memory expectedOriginPattern = abi.encodePacked('"origin":"', expectedOrigin, '"');
        require(
            auth.originIndex + expectedOriginPattern.length <= clientBytes.length,
            "OriginIndexOutOfBounds"
        );
        require(
            _matchesSubsequence(clientBytes, auth.originIndex, expectedOriginPattern),
            "OriginMismatch"
        );

        // 8. Reject crossOrigin:true if present
        require(
            !_contains(clientBytes, bytes('"crossOrigin":true')) &&
            !_contains(clientBytes, bytes('"crossOrigin": true')),
            "CrossOriginNotAllowed"
        );

        // 9. Enforce malleability protection (low-s and valid r)
        require(auth.s > 0 && auth.s <= SECP256R1_HALF_N, "InvalidSignatureS");
        require(auth.r > 0 && auth.r < SECP256R1_N, "InvalidSignatureR");

        // 10. Compute WebAuthn verification message: authenticatorData || sha256(clientDataJSON)
        bytes32 clientDataHash = sha256(clientBytes);
        bytes32 messageHash = sha256(abi.encodePacked(auth.authenticatorData, clientDataHash));

        // 11. Invoke RIP-7212 precompile at 0x100
        bytes memory input = abi.encodePacked(messageHash, auth.r, auth.s, qx, qy);
        (bool success, bytes memory output) = PRECOMPILE_P256.staticcall(input);
        require(success && output.length == 32 && abi.decode(output, (uint256)) == 1, "P256VerificationFailed");
    }

    function _safeTransferToken(address token, address to, uint256 value) internal {
        (bool success, bytes memory ret) = token.call(
            abi.encodeWithSelector(IERC20Token.transfer.selector, to, value)
        );
        require(success && (ret.length == 0 || abi.decode(ret, (bool))), "TokenTransferFailed");
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) return false;
        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    found = false;
                    break;
                }
            }
            if (found) return true;
        }
        return false;
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
