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
  parseAbiItem('function receiveTeleporterMessage(bytes32 originBlockchainID, address originSenderAddress, bytes calldata message) external'),
] as const;

/**
 * Official Avalanche Teleporter v1 Event ABI definitions.
 * Retrieved from verified Teleporter contract at 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf.
 * Full struct tuples ensure topic0 matches production relayer emissions.
 */
export const TELEPORTER_MESSENGER_ABI = [
  {
    type: 'event',
    name: 'SendCrossChainMessage',
    inputs: [
      { name: 'messageID', type: 'bytes32', indexed: true },
      { name: 'destinationBlockchainID', type: 'bytes32', indexed: true },
      {
        name: 'message',
        type: 'tuple',
        components: [
          { name: 'messageNonce', type: 'uint256' },
          { name: 'originSenderAddress', type: 'address' },
          { name: 'destinationBlockchainID', type: 'bytes32' },
          { name: 'destinationAddress', type: 'address' },
          { name: 'requiredGasLimit', type: 'uint256' },
          { name: 'allowedRelayerAddresses', type: 'address[]' },
          {
            name: 'receipts',
            type: 'tuple[]',
            components: [
              { name: 'receivedMessageNonce', type: 'uint256' },
              { name: 'relayerRewardAddress', type: 'address' },
            ],
          },
          { name: 'message', type: 'bytes' },
        ],
      },
      {
        name: 'feeInfo',
        type: 'tuple',
        components: [
          { name: 'feeTokenAddress', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'MessageExecuted',
    inputs: [
      { name: 'messageID', type: 'bytes32', indexed: true },
      { name: 'sourceBlockchainID', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'MessageExecutionFailed',
    inputs: [
      { name: 'messageID', type: 'bytes32', indexed: true },
      { name: 'sourceBlockchainID', type: 'bytes32', indexed: true },
      {
        name: 'message',
        type: 'tuple',
        components: [
          { name: 'messageNonce', type: 'uint256' },
          { name: 'originSenderAddress', type: 'address' },
          { name: 'destinationBlockchainID', type: 'bytes32' },
          { name: 'destinationAddress', type: 'address' },
          { name: 'requiredGasLimit', type: 'uint256' },
          { name: 'allowedRelayerAddresses', type: 'address[]' },
          {
            name: 'receipts',
            type: 'tuple[]',
            components: [
              { name: 'receivedMessageNonce', type: 'uint256' },
              { name: 'relayerRewardAddress', type: 'address' },
            ],
          },
          { name: 'message', type: 'bytes' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'ReceiveCrossChainMessage',
    inputs: [
      { name: 'messageID', type: 'bytes32', indexed: true },
      { name: 'sourceBlockchainID', type: 'bytes32', indexed: true },
      { name: 'deliverer', type: 'address', indexed: true },
      { name: 'rewardRedeemer', type: 'address' },
      {
        name: 'message',
        type: 'tuple',
        components: [
          { name: 'messageNonce', type: 'uint256' },
          { name: 'originSenderAddress', type: 'address' },
          { name: 'destinationBlockchainID', type: 'bytes32' },
          { name: 'destinationAddress', type: 'address' },
          { name: 'requiredGasLimit', type: 'uint256' },
          { name: 'allowedRelayerAddresses', type: 'address[]' },
          {
            name: 'receipts',
            type: 'tuple[]',
            components: [
              { name: 'receivedMessageNonce', type: 'uint256' },
              { name: 'relayerRewardAddress', type: 'address' },
            ],
          },
          { name: 'message', type: 'bytes' },
        ],
      },
    ],
  },
] as const;
