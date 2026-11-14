/**
 * ERC-8004 Agent Registration on Avalanche Fuji IdentityRegistry.
 *
 * IdentityRegistry on Fuji: 0x8004A818BFB912233c491871b3d84c89A494BD9e
 */

import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbiItem,
  Hex,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import {
  FUJI_RPC_URL,
  ERC8004_IDENTITY_REGISTRY,
  getOwnerAccount,
  EXPECTED_OWNER_ADDRESS,
} from './owner-sign';

const IDENTITY_ABI = [
  {
    type: 'function',
    name: 'register',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const;

function updateEnvFile(filePath: string, key: string, value: string) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += (content.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

async function main() {
  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const ownerAccount = getOwnerAccount();
  console.log(`[ERC-8004] Owner Address: ${ownerAccount.address}`);

  // Check if owner already owns an agent NFT
  const balance = await publicClient.readContract({
    address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
    abi: IDENTITY_ABI,
    functionName: 'balanceOf',
    args: [ownerAccount.address],
  });

  console.log(`[ERC-8004] Owner existing Agent count: ${balance}`);

  const agentJsonPath = path.resolve(__dirname, '../docs/erc8004/missionpay-agent.json');
  const agentJsonRaw = fs.readFileSync(agentJsonPath, 'utf8');
  const base64Data = Buffer.from(agentJsonRaw).toString('base64');
  const agentURI = `data:application/json;base64,${base64Data}`;

  let agentId: bigint | null = null;

  if (balance > 0n) {
    // Check if agent ID is already recorded in apps/web/.env
    const appsWebEnvPath = path.resolve(__dirname, '../apps/web/.env');
    const content = fs.readFileSync(appsWebEnvPath, 'utf8');
    const match = content.match(/^ERC8004_AGENT_ID\s*=\s*(\d+)/m);
    if (match) {
      agentId = BigInt(match[1]);
      console.log(`[ERC-8004] Reusing recorded agentId: #${agentId}`);
    }
  }

  if (agentId === null) {
    console.log('[ERC-8004] Simulating register call...');
    const simulatedAgentId = await publicClient.readContract({
      address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      abi: IDENTITY_ABI,
      functionName: 'register',
      args: [agentURI],
      account: ownerAccount.address,
    });
    console.log(`[ERC-8004] Simulation returned expected agentId: #${simulatedAgentId}`);

    console.log('[ERC-8004] Broadcasting register transaction from Owner...');
    const walletClient = createWalletClient({
      account: ownerAccount,
      chain: avalancheFuji,
      transport: http(FUJI_RPC_URL),
    });

    const txHash = await walletClient.writeContract({
      address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      abi: IDENTITY_ABI,
      functionName: 'register',
      args: [agentURI],
    });

    console.log(`[ERC-8004] Registration tx: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[ERC-8004] Registration confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`);

    // Parse Transfer event
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === ERC8004_IDENTITY_REGISTRY.toLowerCase() && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
        if (log.topics[3]) {
          agentId = BigInt(log.topics[3]);
          break;
        }
      }
    }

    if (!agentId) {
      agentId = simulatedAgentId;
    }
    console.log(`[ERC-8004] Minted Agent ID: #${agentId}`);
  }

  // Save to env
  const appsWebEnvPath = path.resolve(__dirname, '../apps/web/.env');
  const contractsEnvPath = path.resolve(__dirname, '../contracts/.env');
  updateEnvFile(appsWebEnvPath, 'ERC8004_AGENT_ID', agentId.toString());
  updateEnvFile(appsWebEnvPath, 'NEXT_PUBLIC_ERC8004_AGENT_ID', agentId.toString());
  updateEnvFile(contractsEnvPath, 'ERC8004_AGENT_ID', agentId.toString());

  console.log(`[ERC-8004] Successfully saved ERC8004_AGENT_ID=${agentId}`);
}

main().catch((err) => {
  console.error('[ERC-8004 Error]', err.message || err);
  process.exit(1);
});
