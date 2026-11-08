// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../src/erc8004/ValidationRegistry.sol";
import "./GuardedTreasury.t.sol";

contract MockIdentityRegistry is IERC721Identity {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public tokenApprovals;
    mapping(address => mapping(address => bool)) public operatorApprovals;

    function mint(address to, uint256 tokenId) external {
        owners[tokenId] = to;
    }

    function approve(address to, uint256 tokenId) external {
        tokenApprovals[tokenId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        operatorApprovals[msg.sender][operator] = approved;
    }

    function ownerOf(uint256 tokenId) external view override returns (address) {
        address o = owners[tokenId];
        require(o != address(0), "NonexistentToken");
        return o;
    }

    function getApproved(uint256 tokenId) external view override returns (address) {
        return tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) external view override returns (bool) {
        return operatorApprovals[owner][operator];
    }
}

contract ValidationRegistryTest is Test {
    MockIdentityRegistry public mockIdentity;
    ValidationRegistry public registry;

    address internal agentOwner = address(0xAAAA);
    address internal validator = address(0xBBBB);
    address internal otherValidator = address(0xCCCC);
    address internal unauthorized = address(0xDDDD);

    uint256 internal constant AGENT_ID = 1;

    function setUp() public {
        mockIdentity = new MockIdentityRegistry();
        mockIdentity.mint(agentOwner, AGENT_ID);

        registry = new ValidationRegistry(address(mockIdentity));
    }

    function test_request_nonOwner_reverts() public {
        bytes32 reqHash = keccak256("req_hash_1");

        vm_prank(unauthorized);
        vm_expectRevert(bytes("Not authorized"));
        registry.validationRequest(validator, AGENT_ID, "ipfs://req1", reqHash);
    }

    function test_response_nonValidator_reverts() public {
        bytes32 reqHash = keccak256("req_hash_2");

        vm_prank(agentOwner);
        registry.validationRequest(validator, AGENT_ID, "ipfs://req2", reqHash);

        vm_prank(otherValidator);
        vm_expectRevert(bytes("Not the designated validator"));
        registry.validationResponse(reqHash, 100, "ipfs://resp2", bytes32(0), "testTag");
    }

    function test_response_greaterThan100_reverts() public {
        bytes32 reqHash = keccak256("req_hash_3");

        vm_prank(agentOwner);
        registry.validationRequest(validator, AGENT_ID, "ipfs://req3", reqHash);

        vm_prank(validator);
        vm_expectRevert(bytes("Response must be 0-100"));
        registry.validationResponse(reqHash, 101, "ipfs://resp3", bytes32(0), "testTag");
    }

    function test_request_duplicate_reverts() public {
        bytes32 reqHash = keccak256("req_hash_4");

        vm_prank(agentOwner);
        registry.validationRequest(validator, AGENT_ID, "ipfs://req4", reqHash);

        vm_prank(agentOwner);
        vm_expectRevert(bytes("Request already exists"));
        registry.validationRequest(validator, AGENT_ID, "ipfs://req4_dup", reqHash);
    }

    function test_happyPath() public {
        bytes32 reqHash = keccak256("req_hash_5");
        bytes32 respHash = keccak256("resp_payload_5");

        vm_prank(agentOwner);
        registry.validationRequest(validator, AGENT_ID, "ipfs://req5", reqHash);

        assertEq(registry.isValidationComplete(reqHash), false);

        vm_prank(validator);
        registry.validationResponse(reqHash, 95, "ipfs://resp5", respHash, "security-audit");

        assertEq(registry.isValidationComplete(reqHash), true);

        (
            address valAddr,
            uint256 aId,
            uint8 response,
            bytes32 rHash,
            string memory tag,
            uint256 lastUpdate
        ) = registry.getValidationStatus(reqHash);

        assertEq(valAddr, validator);
        assertEq(aId, AGENT_ID);
        assertEq(response, 95);
        assertEq(rHash, respHash);
        assertEq(tag, "security-audit");
        assertTrue(lastUpdate > 0);
    }

    function test_getSummary() public {
        bytes32 reqHash1 = keccak256("req_1");
        bytes32 reqHash2 = keccak256("req_2");

        vm_prank(agentOwner);
        registry.validationRequest(validator, AGENT_ID, "ipfs://req1", reqHash1);

        vm_prank(agentOwner);
        registry.validationRequest(otherValidator, AGENT_ID, "ipfs://req2", reqHash2);

        vm_prank(validator);
        registry.validationResponse(reqHash1, 80, "ipfs://resp1", bytes32(0), "audit");

        vm_prank(otherValidator);
        registry.validationResponse(reqHash2, 100, "ipfs://resp2", bytes32(0), "audit");

        address[] memory valFilter = new address[](0);
        (uint64 count, uint8 avg) = registry.getSummary(AGENT_ID, valFilter, "audit");
        assertEq(count, 2);
        assertEq(avg, 90); // (80 + 100) / 2 = 90
    }

    function test_approved_caller_can_request() public {
        bytes32 reqHash = keccak256("req_hash_approved");

        // Approve operator
        vm_prank(agentOwner);
        mockIdentity.approve(unauthorized, AGENT_ID);

        vm_prank(unauthorized);
        registry.validationRequest(validator, AGENT_ID, "ipfs://req_approved", reqHash);

        assertEq(registry.isValidationComplete(reqHash), false);
    }
}
