/**
 * Setup independent Validator wallet for ERC-8004 Validation Registry.
 *
 * Rules:
 * - NEVER log or print the private key to stdout/logs.
 * - Stores VALIDATOR_PRIVATE_KEY in contracts/.env and apps/web/.env.
 * - Transfers 0.03 AVAX from owner wallet on Fuji to fund gas for validation responses.
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
  signAndBroadcastOwnerTx,
  addAllowedTarget,
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
  let match = contractsEnv.match(/^VALIDATOR_PRIVATE_KEY\s*=\s*(0x[a-fA-F0-9]{64})/m);

  let validatorPrivateKey: Hex;
  if (match) {
    validatorPrivateKey = match[1] as Hex;
    console.log('[Validator] Found existing VALIDATOR_PRIVATE_KEY in contracts/.env');
  } else {
    console.log('[Validator] Generating fresh validator private key...');
    validatorPrivateKey = generatePrivateKey();
    updateEnvFile(contractsEnvPath, 'VALIDATOR_PRIVATE_KEY', validatorPrivateKey);
    updateEnvFile(appsWebEnvPath, 'VALIDATOR_PRIVATE_KEY', validatorPrivateKey);
  }

  const validatorAccount = privateKeyToAccount(validatorPrivateKey);
  const validatorAddress = validatorAccount.address;
  console.log(`[Validator] Validator EOA Address: ${validatorAddress}`);

  updateEnvFile(contractsEnvPath, 'VALIDATOR_ADDRESS', validatorAddress);
  updateEnvFile(appsWebEnvPath, 'VALIDATOR_ADDRESS', validatorAddress);
  updateEnvFile(appsWebEnvPath, 'NEXT_PUBLIC_VALIDATOR_ADDRESS', validatorAddress);

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const balance = await publicClient.getBalance({ address: validatorAddress });
  console.log(`[Validator] Current Fuji AVAX Balance: ${formatEther(balance)} AVAX`);

  if (balance < parseEther('0.025')) {
    console.log('[Validator] Funding validator wallet with 0.03 AVAX from Owner...');
    addAllowedTarget(validatorAddress);

    const ownerAccount = getOwnerAccount();
    const walletClient = createWalletClient({
      account: ownerAccount,
      chain: avalancheFuji,
      transport: http(FUJI_RPC_URL),
    });

    const txHash = await walletClient.sendTransaction({
      to: validatorAddress,
      value: parseEther('0.03'),
    });

    console.log(`[Validator] Funding tx broadcast: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Validator] Funding confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`);
  } else {
    console.log('[Validator] Validator has sufficient AVAX balance.');
  }
}

main().catch((err) => {
  console.error('[Validator Error]', err.message || err);
  process.exit(1);
});
