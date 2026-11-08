// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IValidationRegistry.sol";

interface IERC721Identity {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/**
 * @title ValidationRegistry
 * @notice ERC-8004 Validation Registry for Avalanche C-Chain
 * @dev Ported from ava-labs/8004-boilerplate (MIT License).
 * Authorization verified via official ERC-721 IdentityRegistry methods:
 * ownerOf(agentId) == caller || getApproved(agentId) == caller || isApprovedForAll(ownerOf(agentId), caller).
 */
contract ValidationRegistry is IValidationRegistry {
    struct ValidationStatus {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool isComplete;
    }

    IERC721Identity public immutable identityRegistry;
    address public owner;

    // requestHash => ValidationStatus
    mapping(bytes32 => ValidationStatus) private _validations;

    // agentId => array of request hashes
    mapping(uint256 => bytes32[]) private _agentValidations;

    // validatorAddress => array of request hashes
    mapping(address => bytes32[]) private _validatorRequests;

    modifier onlyOwner() {
        require(msg.sender == owner, "Ownable: caller is not the owner");
        _;
    }

    constructor(address _identityRegistry) {
        require(_identityRegistry != address(0), "InvalidIdentityRegistry");
        identityRegistry = IERC721Identity(_identityRegistry);
        owner = msg.sender;
    }

    function getIdentityRegistry() external view override returns (address) {
        return address(identityRegistry);
    }

    /// @notice Check authorization for an agentId using ERC-721 ownership and approvals
    function isAuthorized(uint256 agentId, address caller) public view returns (bool) {
        try identityRegistry.ownerOf(agentId) returns (address agentOwner) {
            if (agentOwner == address(0)) return false;
            if (caller == agentOwner) return true;

            try identityRegistry.getApproved(agentId) returns (address approved) {
                if (approved == caller) return true;
            } catch {}

            try identityRegistry.isApprovedForAll(agentOwner, caller) returns (bool isApprovedAll) {
                if (isApprovedAll) return true;
            } catch {}

            return false;
        } catch {
            return false;
        }
    }

    /// @notice Create a validation request
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external override {
        require(validatorAddress != address(0), "InvalidValidatorAddress");
        require(isAuthorized(agentId, msg.sender), "Not authorized");
        require(_validations[requestHash].lastUpdate == 0, "Request already exists");

        _validations[requestHash] = ValidationStatus({
            validatorAddress: validatorAddress,
            agentId: agentId,
            response: 0,
            responseHash: bytes32(0),
            tag: "",
            lastUpdate: block.timestamp,
            isComplete: false
        });

        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);

        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    /// @notice Submit a validation response
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external override {
        ValidationStatus storage status = _validations[requestHash];
        require(status.lastUpdate > 0, "Request does not exist");
        require(status.validatorAddress == msg.sender, "Not the designated validator");
        require(response <= 100, "Response must be 0-100");

        status.response = response;
        status.responseHash = responseHash;
        status.tag = tag;
        status.lastUpdate = block.timestamp;
        status.isComplete = true;

        emit ValidationResponse(
            msg.sender,
            status.agentId,
            requestHash,
            response,
            responseURI,
            responseHash,
            tag
        );
    }

    /// @notice Get the status of a validation request
    function getValidationStatus(bytes32 requestHash) external view override returns (
        address validatorAddress,
        uint256 agentId,
        uint8 response,
        bytes32 responseHash,
        string memory tag,
        uint256 lastUpdate
    ) {
        ValidationStatus storage status = _validations[requestHash];
        return (
            status.validatorAddress,
            status.agentId,
            status.response,
            status.responseHash,
            status.tag,
            status.lastUpdate
        );
    }

    /// @notice Get summary of validations for an agent
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        string calldata tag
    ) external view override returns (uint64 count, uint8 averageResponse) {
        bytes32[] storage hashes = _agentValidations[agentId];
        uint256 total = 0;

        for (uint256 i = 0; i < hashes.length; i++) {
            ValidationStatus storage status = _validations[hashes[i]];

            if (!status.isComplete) continue;

            if (validatorAddresses.length > 0) {
                bool found = false;
                for (uint256 j = 0; j < validatorAddresses.length; j++) {
                    if (status.validatorAddress == validatorAddresses[j]) {
                        found = true;
                        break;
                    }
                }
                if (!found) continue;
            }

            if (bytes(tag).length > 0 && keccak256(bytes(status.tag)) != keccak256(bytes(tag))) {
                continue;
            }

            total += status.response;
            count++;
        }

        if (count > 0) {
            averageResponse = uint8(total / count);
        }
    }

    /// @notice Get all validation request hashes for an agent
    function getAgentValidations(uint256 agentId) external view override returns (bytes32[] memory requestHashes) {
        return _agentValidations[agentId];
    }

    /// @notice Get all validation request hashes for a validator
    function getValidatorRequests(address validatorAddress) external view override returns (bytes32[] memory requestHashes) {
        return _validatorRequests[validatorAddress];
    }

    /// @notice Check if a validation is complete
    function isValidationComplete(bytes32 requestHash) external view override returns (bool) {
        return _validations[requestHash].isComplete;
    }
}
