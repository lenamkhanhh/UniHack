import { parseAbiItem } from 'viem';

// Verified ABIs matching compiled contracts
export const GATEWAY_ABI = [
  parseAbiItem('function sendSpendRequest(bytes32 missionId, address payee, uint256 amount, bytes32[] calldata proof) external returns (bytes32 messageId, uint256 teleporterMessageID)'),
  parseAbiItem('event SpendRequestSent(bytes32 indexed messageId, bytes32 indexed missionId, address indexed agent, address payee, uint256 amount, uint256 teleporterMessageID)'),
] as const;

// Exactly matches compiled MissionBudgetHub struct order: (agent, payeeRoot, cap, spent, exists, closed)
export const BUDGET_HUB_ABI = [
  parseAbiItem('event SpendExecuted(bytes32 indexed messageId, bytes32 indexed missionId, address indexed agent, address payee, uint256 amount)'),
  parseAbiItem('function executedMessages(bytes32 messageId) external view returns (bool)'),
  parseAbiItem('function missions(bytes32 missionId) external view returns (address agent, bytes32 payeeRoot, uint256 cap, uint256 spent, bool exists, bool closed)'),
] as const;

export const TELEPORTER_MESSENGER_ABI = [
  parseAbiItem('event ReceiveCrossChainMessage(bytes32 indexed messageID, bytes32 indexed originBlockchainID, address indexed deliverer, address originSenderAddress, address destinationAddress, uint256 requiredGasLimit, bytes message)'),
  parseAbiItem('event MessageExecuted(bytes32 indexed messageID, bytes32 indexed sourceBlockchainID)'),
  parseAbiItem('event MessageExecutionFailed(bytes32 indexed messageID, bytes32 indexed sourceBlockchainID)'),
] as const;
