/**
 * Deploys ValidationRegistry to Avalanche Fuji.
 *
 * Rules:
 * - Uses getOwnerAccount() (no private key logged or in CLI args).
 * - Target: Fuji chainId 43113.
 * - IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e.
 */

import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  Hex,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import {
  FUJI_RPC_URL,
  ERC8004_IDENTITY_REGISTRY,
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
  const artifactPath = path.resolve(__dirname, '../contracts/out/ValidationRegistry.sol/ValidationRegistry.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const ownerAccount = getOwnerAccount();
  console.log(`[Deploy] Deployer Address: ${ownerAccount.address}`);

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const walletClient = createWalletClient({
    account: ownerAccount,
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  console.log(`[Deploy] Deploying ValidationRegistry with IdentityRegistry: ${ERC8004_IDENTITY_REGISTRY}...`);

  const deployHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args: [ERC8004_IDENTITY_REGISTRY],
  });

  console.log(`[Deploy] Deployment tx broadcast: ${deployHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });

  if (!receipt.contractAddress) {
    throw new Error('Deployment failed: no contractAddress in receipt');
  }

  const deployedAddress = receipt.contractAddress;
  console.log(`[Deploy] ValidationRegistry deployed at: ${deployedAddress}`);
  console.log(`[Deploy] Confirmed in block ${receipt.blockNumber}, gasUsed: ${receipt.gasUsed}`);

  const contractsEnvPath = path.resolve(__dirname, '../contracts/.env');
  const appsWebEnvPath = path.resolve(__dirname, '../apps/web/.env');

  updateEnvFile(contractsEnvPath, 'VALIDATION_REGISTRY_ADDRESS', deployedAddress);
  updateEnvFile(appsWebEnvPath, 'VALIDATION_REGISTRY_ADDRESS', deployedAddress);
  updateEnvFile(appsWebEnvPath, 'NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS', deployedAddress);

  console.log('[Deploy] Updated .env files with VALIDATION_REGISTRY_ADDRESS');
}

main().catch((err) => {
  console.error('[Deploy Error]', err.message || err);
  process.exit(1);
});
