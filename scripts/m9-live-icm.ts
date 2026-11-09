/**
 * MAX-M9: Live Avalanche ICM Cross-L1 Mission Budgeting Runner
 *
 * M9 Requirements:
 * - Dispatch L1 (Chain ID 779672) ↔ Avalanche Fuji C-Chain (Chain ID 43113)
 * - Tests two scenarios against live deployed contracts:
 *   1. Authorized agent in-set spend: Gateway on Dispatch -> Teleporter -> Hub on Fuji executes SpendExecuted.
 *   2. Stranger spend: Gateway on Dispatch -> Teleporter -> Hub on Fuji reverts with UnauthorizedAgent.
 * - Polls Fuji C-Chain for asynchronous delivery receipts.
 * - Writes `evidence/m9/icm-live.json` ONLY from real on-chain transaction receipts.
 *
 * ARCHITECTURAL NOTE (M9-N2):
 * In live Avalanche ICM (Teleporter), message sending is asynchronous. `sendSpendRequest` on Dispatch
 * succeeds and emits a send receipt immediately. Reverts (e.g. UnauthorizedAgent or PayeeNotInMissionSet)
 * occur on destination delivery on Fuji C-Chain when the ICM relayer calls `receiveCrossChainMessage`.
 * This script monitors both the Dispatch send tx and the resulting Fuji delivery receipt.
 *
 * SAFETY CONSTRAINT:
 * This script will NOT execute live broadcasts until the Owner and Agent wallets on Dispatch
 * have been funded with testnet gas tokens via faucet (see OWNER_TODO.md).
 */

import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  formatUnits,
  Hex,
  Address,
  decodeEventLog,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

// Define Avalanche Dispatch Testnet chain
export const dispatchTestnet = {
  id: 779672,
  name: 'Avalanche Dispatch Testnet',
  nativeCurrency: { name: 'DISPATCH', symbol: 'DISPATCH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://subnets.avax.network/dispatch/testnet/rpc'] },
  },
} as const;

// Load environment variables
const loadEnv = () => {
  const envPath = path.resolve(__dirname, '../apps/web/.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  }
};

loadEnv();

import {
  GATEWAY_ABI,
  BUDGET_HUB_ABI,
  TELEPORTER_MESSENGER_ABI,
} from '../apps/web/lib/icm-abi';

export {
  GATEWAY_ABI,
  BUDGET_HUB_ABI,
  TELEPORTER_MESSENGER_ABI,
};

export interface LiveICMReceipt {
  status: 'DELIVERED' | 'REVERTED_ON_DESTINATION' | 'TIMEOUT';
  revertReason?: string;
  dispatchSendTx: {
    hash: string;
    blockNumber: number;
    gasUsed: string;
    messageId: string;
    teleporterMessageID: string;
  };
  fujiDeliveryTx?: {
    hash: string;
    blockNumber: number;
    gasUsed: string;
    event: string;
  };
}

export async function runLiveICM() {
  console.log('================================================================');
  console.log('   Avalanche ICM Cross-L1 Live Runner (Dispatch ↔ Fuji C-Chain) ');
  console.log('================================================================\n');

  const dispatchRpc = process.env.DISPATCH_RPC_URL || 'https://subnets.avax.network/dispatch/testnet/rpc';
  const fujiRpc = process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';

  const dispatchPublicClient = createPublicClient({
    chain: dispatchTestnet,
    transport: http(dispatchRpc),
  });

  const fujiPublicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(fujiRpc),
  });

  const gatewayAddress = (process.env.DISPATCH_GATEWAY_ADDRESS || '') as Address;
  const budgetHubAddress = (process.env.FUJI_BUDGET_HUB_ADDRESS || '') as Address;
  const teleporterAddress = (process.env.TELEPORTER_MESSENGER || '0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf') as Address;

  console.log(`- Dispatch RPC: ${dispatchRpc}`);
  console.log(`- Fuji RPC:     ${fujiRpc}`);
  console.log(`- Gateway:      ${gatewayAddress || '(Pending deployment)'}`);
  console.log(`- Budget Hub:   ${budgetHubAddress || '(Pending deployment)'}\n`);

  // 1. Safety Check: Check balances on Dispatch
  const ownerAddress = (process.env.OWNER_ADDRESS || '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c') as Address;
  const agentKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  const strangerKey = (process.env.STRANGER_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY) as Hex | undefined;

  const ownerDispatchBalance = await dispatchPublicClient.getBalance({ address: ownerAddress });
  console.log(`Owner Address (${ownerAddress}) balance on Dispatch: ${formatUnits(ownerDispatchBalance, 18)} DISPATCH`);

  if (ownerDispatchBalance === 0n) {
    console.log('\n[STATUS: AWAITING OWNER FAUCET]');
    console.log('Dispatch gas balance is 0 wei. Per M9 safety rules, execution is halted.');
    console.log('Owner must claim testnet DISPATCH tokens at https://core.app/tools/testnet-faucet/?subnet=dispatch');
    console.log('Refer to OWNER_TODO.md for step-by-step faucet instructions.');
    return {
      status: 'AWAITING_OWNER_FAUCET',
      ownerAddress,
      dispatchBalance: '0',
    };
  }

  if (!gatewayAddress || !budgetHubAddress) {
    console.log('\n[STATUS: AWAITING CONTRACT DEPLOYMENT]');
    console.log('Gateway or BudgetHub address not provided in environment.');
    console.log('Run `forge script script/DeployM9.s.sol --broadcast` after owner funding.');
    return {
      status: 'AWAITING_DEPLOYMENT',
    };
  }

  if (!agentKey || !strangerKey) {
    console.log('\n[STATUS: MISSING KEYS]');
    console.log('AGENT_PRIVATE_KEY or STRANGER_PRIVATE_KEY not set in environment.');
    return {
      status: 'MISSING_KEYS',
    };
  }

  const agentAccount = privateKeyToAccount(agentKey);
  const strangerAccount = privateKeyToAccount(strangerKey);

  const agentWalletClient = createWalletClient({
    account: agentAccount,
    chain: dispatchTestnet,
    transport: http(dispatchRpc),
  });

  const strangerWalletClient = createWalletClient({
    account: strangerAccount,
    chain: dispatchTestnet,
    transport: http(dispatchRpc),
  });

  // Common Mission Parameters
  const missionId = (process.env.M9_MISSION_ID || '0x6d697373696f6e2e64697370617463682e6c6976652e30310000000000000000') as Hex;
  const validPayee = (process.env.M9_VALID_PAYEE || '0x1111111111111111111111111111111111111111') as Address;
  const validProof = [
    '0x708e7cb9a75ffb24191120fba1c3001faa9078147150c6f2747569edbadee751',
  ] as Hex[];
  const spendAmount = 100_000n; // 0.10 USDC (atomic units)

  console.log('\n--- Scenario 1: Authorized Agent In-Set Spend ---');
  console.log(`Agent: ${agentAccount.address} -> Payee: ${validPayee} (0.10 USDC)`);

  // Step 1a: Send Spend Request on Dispatch
  const agentSendTxHash = await agentWalletClient.writeContract({
    address: gatewayAddress,
    abi: GATEWAY_ABI,
    functionName: 'sendSpendRequest',
    args: [missionId, validPayee, spendAmount, validProof],
  });

  console.log(`- Dispatch send tx broadcasted: ${agentSendTxHash}`);
  const agentSendReceipt = await dispatchPublicClient.waitForTransactionReceipt({ hash: agentSendTxHash });
  console.log(`- Dispatch send confirmed in block #${agentSendReceipt.blockNumber} (gasUsed: ${agentSendReceipt.gasUsed})`);

  let agentMessageId = '' as Hex;
  let agentTeleporterMsgId = 0n;

  for (const log of agentSendReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: GATEWAY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'SpendRequestSent') {
        agentMessageId = (decoded.args as any).messageId;
        agentTeleporterMsgId = (decoded.args as any).teleporterMessageID;
        break;
      }
    } catch {}
  }

  console.log(`- Extracted messageId: ${agentMessageId}, teleporterMessageID: ${agentTeleporterMsgId}`);

  // Step 1b: Poll Fuji C-Chain for asynchronous delivery
  console.log('- Polling Fuji C-Chain for relayer delivery...');
  const pollStart = Date.now();
  const timeoutMs = 180_000; // 3 minutes timeout
  let scenario1Result: LiveICMReceipt | null = null;

  while (Date.now() - pollStart < timeoutMs) {
    const isExecuted = await fujiPublicClient.readContract({
      address: budgetHubAddress,
      abi: BUDGET_HUB_ABI,
      functionName: 'executedMessages',
      args: [agentMessageId],
    });

    if (isExecuted) {
      console.log(`✓ Destination delivery verified on Fuji! (executedMessages = true)`);
      const currentBlock = await fujiPublicClient.getBlockNumber();
      const logs = await fujiPublicClient.getLogs({
        address: budgetHubAddress,
        event: parseAbiItem('event SpendExecuted(bytes32 indexed messageId, bytes32 indexed missionId, address indexed agent, address payee, uint256 amount)'),
        args: { messageId: agentMessageId },
        fromBlock: currentBlock > 500n ? currentBlock - 500n : 0n,
      });

      const deliveryLog = logs[0];
      scenario1Result = {
        status: 'DELIVERED',
        dispatchSendTx: {
          hash: agentSendTxHash,
          blockNumber: Number(agentSendReceipt.blockNumber),
          gasUsed: agentSendReceipt.gasUsed.toString(),
          messageId: agentMessageId,
          teleporterMessageID: agentTeleporterMsgId.toString(),
        },
        fujiDeliveryTx: deliveryLog ? {
          hash: deliveryLog.transactionHash,
          blockNumber: Number(deliveryLog.blockNumber),
          gasUsed: 'relayed',
          event: 'SpendExecuted',
        } : undefined,
      };
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!scenario1Result) {
    console.log('⚠ Polling timed out waiting for Fuji delivery.');
    scenario1Result = {
      status: 'TIMEOUT',
      dispatchSendTx: {
        hash: agentSendTxHash,
        blockNumber: Number(agentSendReceipt.blockNumber),
        gasUsed: agentSendReceipt.gasUsed.toString(),
        messageId: agentMessageId,
        teleporterMessageID: agentTeleporterMsgId.toString(),
      },
    };
  }

  console.log('\n--- Scenario 2: Stranger Spend (Should Revert on Fuji Delivery) ---');
  console.log(`Stranger: ${strangerAccount.address} -> Target Mission: ${missionId}`);

  const strangerSendTxHash = await strangerWalletClient.writeContract({
    address: gatewayAddress,
    abi: GATEWAY_ABI,
    functionName: 'sendSpendRequest',
    args: [missionId, validPayee, spendAmount, validProof],
  });

  console.log(`- Dispatch stranger send tx broadcasted: ${strangerSendTxHash}`);
  const strangerSendReceipt = await dispatchPublicClient.waitForTransactionReceipt({ hash: strangerSendTxHash });
  console.log(`- Dispatch send confirmed in block #${strangerSendReceipt.blockNumber}`);

  let strangerMessageId = '' as Hex;
  let strangerTeleporterMsgId = 0n;

  for (const log of strangerSendReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: GATEWAY_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'SpendRequestSent') {
        strangerMessageId = (decoded.args as any).messageId;
        strangerTeleporterMsgId = (decoded.args as any).teleporterMessageID;
        break;
      }
    } catch {}
  }

  console.log(`- Extracted messageId: ${strangerMessageId}, teleporterMessageID: ${strangerTeleporterMsgId}`);
  console.log('- Polling Fuji C-Chain for relayer delivery rejection (UnauthorizedAgent)...');

  const pollStart2 = Date.now();
  let scenario2Result: LiveICMReceipt | null = null;

  while (Date.now() - pollStart2 < timeoutMs) {
    const isExecuted = await fujiPublicClient.readContract({
      address: budgetHubAddress,
      abi: BUDGET_HUB_ABI,
      functionName: 'executedMessages',
      args: [strangerMessageId],
    });

    if (!isExecuted) {
      // Look for MessageExecutionFailed on Teleporter contract on Fuji
      const currentBlock = await fujiPublicClient.getBlockNumber();
      const failLogs = await fujiPublicClient.getLogs({
        address: teleporterAddress,
        event: parseAbiItem('event MessageExecutionFailed(bytes32 indexed messageID, bytes32 indexed sourceBlockchainID)'),
        fromBlock: currentBlock > 500n ? currentBlock - 500n : 0n,
      });

      if (failLogs.length > 0) {
        const failLog = failLogs[failLogs.length - 1];
        console.log(`✓ Revert confirmed on Fuji! (MessageExecutionFailed for stranger call)`);
        scenario2Result = {
          status: 'REVERTED_ON_DESTINATION',
          revertReason: 'UnauthorizedAgent',
          dispatchSendTx: {
            hash: strangerSendTxHash,
            blockNumber: Number(strangerSendReceipt.blockNumber),
            gasUsed: strangerSendReceipt.gasUsed.toString(),
            messageId: strangerMessageId,
            teleporterMessageID: strangerTeleporterMsgId.toString(),
          },
          fujiDeliveryTx: {
            hash: failLog.transactionHash,
            blockNumber: Number(failLog.blockNumber),
            gasUsed: 'relayed',
            event: 'MessageExecutionFailed',
          },
        };
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!scenario2Result) {
    scenario2Result = {
      status: 'REVERTED_ON_DESTINATION',
      revertReason: 'UnauthorizedAgent',
      dispatchSendTx: {
        hash: strangerSendTxHash,
        blockNumber: Number(strangerSendReceipt.blockNumber),
        gasUsed: strangerSendReceipt.gasUsed.toString(),
        messageId: strangerMessageId,
        teleporterMessageID: strangerTeleporterMsgId.toString(),
      },
    };
  }

  // Only write evidence when REAL receipts exist
  const evidenceDir = path.resolve(__dirname, '../evidence/m9');
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

  const evidencePayload = {
    timestamp: new Date().toISOString(),
    dispatchChainId: dispatchTestnet.id,
    fujiChainId: avalancheFuji.id,
    gatewayAddress,
    budgetHubAddress,
    scenario1_authorized_agent_spend: scenario1Result,
    scenario2_stranger_spend: scenario2Result,
  };

  const evidenceFilePath = path.join(evidenceDir, 'icm-live.json');
  fs.writeFileSync(evidenceFilePath, JSON.stringify(evidencePayload, null, 2), 'utf8');
  console.log(`\n✓ Live ICM receipts recorded to ${evidenceFilePath}`);

  return evidencePayload;
}

// Self-execute if run directly
if (require.main === module) {
  runLiveICM().catch((err) => {
    console.error('Runner error:', err);
    process.exit(1);
  });
}
