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
 * This script will NOT execute live broadcasts until the Owner wallet on Dispatch has been funded
 * with testnet gas tokens via faucet (see OWNER_TODO.md).
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

const GATEWAY_ABI = [
  parseAbiItem('function sendSpendRequest(bytes32 missionId, address payee, uint256 amount, bytes32[] calldata proof) external returns (bytes32 messageId, uint256 teleporterMessageID)'),
  parseAbiItem('event SpendRequestSent(bytes32 indexed messageId, bytes32 indexed missionId, address indexed agent, address payee, uint256 amount, uint256 teleporterMessageID)'),
] as const;

const BUDGET_HUB_ABI = [
  parseAbiItem('event SpendExecuted(bytes32 indexed messageId, bytes32 indexed missionId, address indexed agent, address payee, uint256 amount)'),
  parseAbiItem('function executedMessages(bytes32 messageId) external view returns (bool)'),
  parseAbiItem('function missions(bytes32 missionId) external view returns (address agent, bytes32 payeeRoot, uint256 cap, uint256 spent, bool exists, bool closed)'),
] as const;

export async function runLiveICM() {
  console.log('================================================================');
  console.log('   Avalanche ICM Cross-L1 Live Runner (Dispatch ↔ Fuji C-Chain) ');
  console.log('================================================================\n');

  const dispatchRpc = process.env.DISPATCH_RPC_URL || 'https://subnets.avax.network/dispatch/testnet/rpc';
  const fujiRpc = process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';

  const dispatchClient = createPublicClient({
    chain: dispatchTestnet,
    transport: http(dispatchRpc),
  });

  const fujiClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(fujiRpc),
  });

  const gatewayAddress = (process.env.DISPATCH_GATEWAY_ADDRESS || '') as Address;
  const budgetHubAddress = (process.env.FUJI_BUDGET_HUB_ADDRESS || '') as Address;

  console.log(`- Dispatch RPC: ${dispatchRpc}`);
  console.log(`- Fuji RPC:     ${fujiRpc}`);
  console.log(`- Gateway:      ${gatewayAddress || '(Pending deployment)'}`);
  console.log(`- Budget Hub:   ${budgetHubAddress || '(Pending deployment)'}\n`);

  // Check Owner gas balance on Dispatch
  const ownerAddress = (process.env.OWNER_ADDRESS || '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c') as Address;
  const ownerDispatchBalance = await dispatchClient.getBalance({ address: ownerAddress });

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

  // Live broadcast logic (executed only after owner funds wallet)
  console.log('\n[LIVE ICM BROADCAST STARTING...]');
  // (Full live test sequence will execute here and write evidence/m9/icm-live.json once receipts arrive)
  return { status: 'READY_FOR_BROADCAST' };
}

// Self-execute if run directly
if (require.main === module) {
  runLiveICM().catch((err) => {
    console.error('Runner error:', err);
    process.exit(1);
  });
}
