/**
 * Setup dedicated Relayer wallet for Passkey Relay Route (W4-F1).
 *
 * Rules:
 * - NEVER log or print the private key to stdout/logs.
 * - Stores RELAYER_PRIVATE_KEY in contracts/.env and apps/web/.env.
 * - Transfers 0.02 AVAX from owner wallet on Fuji to fund gas for relaying passkey transactions.
 * - Relayer has ZERO administrative authority in GuardedTreasury or PasskeyMissionAuthority.
 */

import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import {
  FUJI_RPC_URL,
  EXPECTED_OWNER_ADDRESS,
  getOwnerAccount,
} from './owner-sign';

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
  const contractsEnvPath = path.resolve(__dirname, '../contracts/.env');
  const appsWebEnvPath = path.resolve(__dirname, '../apps/web/.env');

  let contractsEnv = fs.existsSync(contractsEnvPath) ? fs.readFileSync(contractsEnvPath, 'utf8') : '';
  let match = contractsEnv.match(/^RELAYER_PRIVATE_KEY\s*=\s*(0x[a-fA-F0-9]{64})/m);

  let relayerPrivateKey: Hex;
  if (match) {
    relayerPrivateKey = match[1] as Hex;
    console.log('[Relayer Setup] Found existing RELAYER_PRIVATE_KEY in contracts/.env');
  } else {
    console.log('[Relayer Setup] Generating fresh dedicated relayer private key...');
    relayerPrivateKey = generatePrivateKey();
    updateEnvFile(contractsEnvPath, 'RELAYER_PRIVATE_KEY', relayerPrivateKey);
    updateEnvFile(appsWebEnvPath, 'RELAYER_PRIVATE_KEY', relayerPrivateKey);
  }

  const relayerAccount = privateKeyToAccount(relayerPrivateKey);
  console.log(`[Relayer Setup] Dedicated Relayer Address: ${relayerAccount.address}`);
  console.log(`[Relayer Setup] Owner Address:             ${EXPECTED_OWNER_ADDRESS}`);

  if (relayerAccount.address.toLowerCase() === EXPECTED_OWNER_ADDRESS.toLowerCase()) {
    throw new Error('FATAL SECURITY VIOLATION: Relayer address cannot match Owner address');
  }

  updateEnvFile(contractsEnvPath, 'NEXT_PUBLIC_RELAYER_ADDRESS', relayerAccount.address);
  updateEnvFile(appsWebEnvPath, 'NEXT_PUBLIC_RELAYER_ADDRESS', relayerAccount.address);

  // Check on-chain balance on Avalanche Fuji
  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const relayerBalance = await publicClient.getBalance({ address: relayerAccount.address });
  console.log(`[Relayer Setup] Current Relayer Balance: ${formatEther(relayerBalance)} AVAX`);

  // Target balance: 0.02 AVAX
  const targetFund = parseEther('0.02');
  if (relayerBalance < parseEther('0.015')) {
    console.log('[Relayer Setup] Funding relayer with 0.02 AVAX from owner on Fuji...');
    const ownerAccount = getOwnerAccount();
    const ownerWalletClient = createWalletClient({
      account: ownerAccount,
      chain: avalancheFuji,
      transport: http(FUJI_RPC_URL),
    });

    const fundTx = await ownerWalletClient.sendTransaction({
      to: relayerAccount.address,
      value: targetFund,
    });

    console.log(`[Relayer Setup] Broadcast funding tx: ${fundTx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: fundTx });
    console.log(`[Relayer Setup] Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`);

    const newBalance = await publicClient.getBalance({ address: relayerAccount.address });
    console.log(`[Relayer Setup] New Relayer Balance: ${formatEther(newBalance)} AVAX`);
  } else {
    console.log('[Relayer Setup] Relayer already has sufficient gas balance.');
  }
}

main().catch((err) => {
  console.error('[Relayer Setup Error]', err.message || err);
  process.exit(1);
});
