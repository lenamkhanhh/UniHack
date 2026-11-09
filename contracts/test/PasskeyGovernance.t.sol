// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./PasskeyMissionAuthority.t.sol";

contract PasskeyGovernanceTest is PasskeyMissionAuthorityTest {
    function _buildOwnerActionAuth(
        bytes memory callData,
        uint256 nonce,
        uint256 privKey
    ) internal returns (PasskeyMissionAuthority.WebAuthnAuth memory) {
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-owner-action-v1",
                block.chainid,
                address(authority),
                address(treasury),
                keccak256(callData),
                nonce
            )
        );
        return _buildWebAuthnAuth(challenge, privKey, 0x05);
    }

    function _buildWithdrawAuth(
        address to,
        uint256 amount,
        uint256 nonce,
        uint256 privKey
    ) internal returns (PasskeyMissionAuthority.WebAuthnAuth memory) {
        address usdcToken = treasury.USDC();
        bytes32 challenge = keccak256(
            abi.encode(
                "MissionPay-passkey-withdraw-v1",
                block.chainid,
                address(authority),
                usdcToken,
                to,
                amount,
                nonce
            )
        );
        return _buildWebAuthnAuth(challenge, privKey, 0x05);
    }

    function _executeOwnerAction(bytes memory callData) internal {
        uint256 n = authority.nextNonce();
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildOwnerActionAuth(callData, n, passkeyPrivKey);
        authority.executeOwnerAction(callData, n, auth);
    }

    function _withdrawTokens(address to, uint256 amount) internal {
        uint256 n = authority.nextNonce();
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWithdrawAuth(to, amount, n, passkeyPrivKey);
        authority.withdrawTokens(to, amount, n, auth);
    }

    function _approveMission(bytes32 mId, bytes32 root, uint256 mCap) internal {
        uint256 n = authority.nextNonce();
        bytes32 ch = keccak256(
            abi.encode(
                "MissionPay-passkey-v1",
                block.chainid,
                address(authority),
                mId,
                agent,
                root,
                mCap,
                duration,
                toolCap,
                n
            )
        );
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildWebAuthnAuth(ch, passkeyPrivKey, 0x05);
        authority.approveMission(mId, agent, root, mCap, duration, toolCap, n, auth);
    }

    function _getProposalStatus(uint256 pid) internal view returns (uint8) {
        (bool ok, bytes memory data) = address(treasury).staticcall(abi.encodeWithSelector(treasury.proposals.selector, pid));
        require(ok && data.length >= 224, "staticcall failed");
        bytes32 val;
        assembly {
            val := mload(add(data, 224))
        }
        return uint8(uint256(val));
    }

    // --- A3 Acceptance Tests ---

    function test_A3_ownerAction_setRecipient() public {
        address newPayee = address(0x2222);
        assertFalse(treasury.recipientAllowlist(newPayee));

        _executeOwnerAction(abi.encodeWithSelector(treasury.setRecipient.selector, newPayee, true));
        assertTrue(treasury.recipientAllowlist(newPayee));
    }

    function test_A3_ownerAction_pause_and_unpause() public {
        assertFalse(treasury.paused());

        _executeOwnerAction(abi.encodeWithSelector(treasury.pause.selector));
        assertTrue(treasury.paused());

        _executeOwnerAction(abi.encodeWithSelector(treasury.unpause.selector));
        assertFalse(treasury.paused());
    }

    function test_A3_ownerAction_fundMissionWallet() public {
        _approveMission(missionId, payeeRoot, cap);

        usdc.mint(address(treasury), 10_000_000);

        address sessionWallet = address(0x3333);
        uint256 fundAmount = 500_000;
        bytes memory fundData = abi.encodeWithSelector(
            bytes4(keccak256("fundMissionWallet(bytes32,address,uint256)")),
            missionId,
            sessionWallet,
            fundAmount
        );

        _executeOwnerAction(fundData);

        assertEq(usdc.balanceOf(sessionWallet), fundAmount);
        assertTrue(treasury.missionFunded(missionId));
    }

    function test_A3_ownerAction_approve_and_execute_queued_proposal() public {
        bytes32 mId = keccak256("m_allowlist");
        _approveMission(mId, bytes32(0), 20_000_000);

        address payee = address(0x4444);
        _executeOwnerAction(abi.encodeWithSelector(treasury.setRecipient.selector, payee, true));

        usdc.mint(address(treasury), 20_000_000);

        // Propose 6 USDC (over perTxCap 5 USDC) by agent -> QUEUED
        vm_prank(agent);
        uint256 pid = treasury.propose(keccak256("op1"), payee, 6_000_000, mId, "Queued proposal");
        assertEq(pid, 0);
        assertEq(_getProposalStatus(0), 1); // Queued

        _executeOwnerAction(abi.encodeWithSelector(treasury.approve.selector, pid));
        assertEq(_getProposalStatus(0), 2); // Approved

        _executeOwnerAction(abi.encodeWithSelector(treasury.execute.selector, pid));
        assertEq(_getProposalStatus(0), 3); // Executed
        assertEq(usdc.balanceOf(payee), 6_000_000);
    }

    function test_A3_ownerAction_closeMission_and_anchorMissionProof() public {
        _approveMission(missionId, payeeRoot, cap);

        bytes32 headHash = keccak256("audit_head_sample");
        _executeOwnerAction(abi.encodeWithSelector(treasury.anchorMissionProof.selector, missionId, headHash));
        assertEq(treasury.anchoredMissionProofs(missionId), headHash);

        _executeOwnerAction(abi.encodeWithSelector(treasury.closeMission.selector, missionId));
        (, , , , , bool closed) = treasury.missions(missionId);
        assertTrue(closed);
    }

    function test_A3_emergencyWithdraw_and_withdrawTokens() public {
        uint256 depositAmount = 5_000_000;
        usdc.mint(address(treasury), depositAmount);

        _executeOwnerAction(abi.encodeWithSelector(treasury.pause.selector));
        _executeOwnerAction(abi.encodeWithSelector(treasury.emergencyWithdraw.selector));

        assertEq(usdc.balanceOf(address(treasury)), 0);
        assertEq(usdc.balanceOf(address(authority)), depositAmount);

        address recoveryVault = address(0x8888);
        _withdrawTokens(recoveryVault, depositAmount);

        assertEq(usdc.balanceOf(recoveryVault), depositAmount);
        assertEq(usdc.balanceOf(address(authority)), 0);
    }

    function test_A3_negative_unallowlisted_selector_reverts() public {
        bytes memory badCall = abi.encodeWithSignature("transferOwnership(address)", address(0xdead));
        uint256 nonce = authority.nextNonce();
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildOwnerActionAuth(badCall, nonce, passkeyPrivKey);

        vm_expectRevertString("SelectorNotAllowed");
        authority.executeOwnerAction(badCall, nonce, auth);
    }

    function test_A3_negative_wrong_calldata_or_nonce_reverts() public {
        bytes memory callData = abi.encodeWithSelector(treasury.pause.selector);
        uint256 nonce = authority.nextNonce();
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildOwnerActionAuth(callData, nonce, passkeyPrivKey);

        bytes memory tamperedCall = abi.encodeWithSelector(treasury.unpause.selector);
        vm_expectRevertString("ChallengeMismatch");
        authority.executeOwnerAction(tamperedCall, nonce, auth);

        vm_expectRevertString("InvalidNonce");
        authority.executeOwnerAction(callData, nonce + 1, auth);
    }

    function test_A3_negative_invalid_signature_reverts() public {
        bytes memory callData = abi.encodeWithSelector(treasury.pause.selector);
        uint256 nonce = authority.nextNonce();
        PasskeyMissionAuthority.WebAuthnAuth memory auth = _buildOwnerActionAuth(callData, nonce, passkeyPrivKey);
        auth.r = 0; // r = 0 triggers InvalidSignatureR

        vm_expectRevertString("InvalidSignatureR");
        authority.executeOwnerAction(callData, nonce, auth);
    }

    function test_A3_negative_withdrawTokens_validations_revert() public {
        uint256 n = authority.nextNonce();
        PasskeyMissionAuthority.WebAuthnAuth memory authZero = _buildWithdrawAuth(address(0), 1_000_000, n, passkeyPrivKey);
        vm_expectRevertString("InvalidRecipient");
        authority.withdrawTokens(address(0), 1_000_000, n, authZero);

        PasskeyMissionAuthority.WebAuthnAuth memory authSelf = _buildWithdrawAuth(address(authority), 1_000_000, n, passkeyPrivKey);
        vm_expectRevertString("InvalidRecipient");
        authority.withdrawTokens(address(authority), 1_000_000, n, authSelf);

        PasskeyMissionAuthority.WebAuthnAuth memory authBal = _buildWithdrawAuth(address(0x8888), 1_000_000, n, passkeyPrivKey);
        vm_expectRevertString("InsufficientBalance");
        authority.withdrawTokens(address(0x8888), 1_000_000, n, authBal);
    }
}
