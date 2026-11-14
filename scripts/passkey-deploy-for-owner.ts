/**
 * Deploy dedicated GuardedTreasury + PasskeyMissionAuthority for Owner's Hardware Passkey (W4-F2 / PK-F1).
 *
 * Usage:
 *   npx tsx scripts/passkey-deploy-for-owner.ts --qx <0xHex> --qy <0xHex> [--rp-id localhost] [--origin http://localhost:3100] [--broadcast]
 *
 * Accepts public coordinates (qx, qy) exported by owner from /missions/new
 * after registering hardware biometric passkey (Windows Hello / Touch ID / Face ID).
 *
 * NOTE: DO NOT broadcast automatically. This script is intended for execution by the OWNER.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  getContractAddress,
  Hex,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import {
  FUJI_RPC_URL,
  FUJI_USDC_ADDRESS,
  getOwnerAccount,
} from './owner-sign';

async function main() {
  const args = process.argv.slice(2);
  let qxArg = '';
  let qyArg = '';
  let rpIdArg = 'localhost';
  let originArg = 'http://localhost:3100';
  let requireUV = true;
  let doBroadcast = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--qx' && args[i + 1]) {
      qxArg = args[++i];
    } else if (args[i] === '--qy' && args[i + 1]) {
      qyArg = args[++i];
    } else if (args[i] === '--rp-id' && args[i + 1]) {
      rpIdArg = args[++i];
    } else if (args[i] === '--origin' && args[i + 1]) {
      originArg = args[++i];
    } else if (args[i] === '--no-uv') {
      requireUV = false;
    } else if (args[i] === '--broadcast') {
      doBroadcast = true;
    }
  }

  if (!qxArg || !qyArg) {
    console.error('Usage: npx tsx scripts/passkey-deploy-for-owner.ts --qx <0xHex> --qy <0xHex> [--rp-id localhost] [--origin http://localhost:3100] [--broadcast]');
    console.error('Example:');
    console.error('  npx tsx scripts/passkey-deploy-for-owner.ts --qx 0x1111... --qy 0x2222... --broadcast');
    process.exit(1);
  }

  const passkeyX = BigInt(qxArg.startsWith('0x') ? qxArg : `0x${qxArg}`);
  const passkeyY = BigInt(qyArg.startsWith('0x') ? qyArg : `0x${qyArg}`);
  const rpIdHash = ('0x' + crypto.createHash('sha256').update(rpIdArg).digest('hex')) as Hex;

  console.log('[Passkey Deploy For Owner] Initializing setup with Owner hardware credentials:');
  console.log(`  qx: 0x${passkeyX.toString(16)}`);
  console.log(`  qy: 0x${passkeyY.toString(16)}`);
  console.log(`  RP ID: ${rpIdArg} (hash: ${rpIdHash})`);
  console.log(`  Expected Origin: ${originArg}`);
  console.log(`  Require User Verification (UV): ${requireUV}`);
  console.log(`  Broadcast mode: ${doBroadcast ? 'ENABLED (LIVE FUJI)' : 'DRY-RUN (Simulated)'}`);

  const ownerAccount = getOwnerAccount();
  console.log(`  Deployer Address: ${ownerAccount.address}`);

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const walletClient = createWalletClient({
    account: ownerAccount,
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  // Predict authority contract address
  const currentNonce = await publicClient.getTransactionCount({ address: ownerAccount.address });
  const predictedAuthority = getContractAddress({
    from: ownerAccount.address,
    nonce: BigInt(currentNonce + 1),
  });
  console.log(`  Current Nonce: ${currentNonce}`);
  console.log(`  Predicted PasskeyMissionAuthority: ${predictedAuthority}`);

  // Load compiled artifacts
  const treasuryArtifactPath = path.resolve(__dirname, '../contracts/out/GuardedTreasury.sol/GuardedTreasury.json');
  const authorityArtifactPath = path.resolve(__dirname, '../contracts/out/PasskeyMissionAuthority.sol/PasskeyMissionAuthority.json');

  if (!fs.existsSync(treasuryArtifactPath) || !fs.existsSync(authorityArtifactPath)) {
    throw new Error('Contract artifacts missing. Please run `forge build` in contracts/ first.');
  }

  const treasuryArtifact = JSON.parse(fs.readFileSync(treasuryArtifactPath, 'utf8'));
  const authorityArtifact = JSON.parse(fs.readFileSync(authorityArtifactPath, 'utf8'));

  if (!doBroadcast) {
    console.log('\n[DRY RUN COMPLETE] Simulated contract deployment parameters valid.');
    console.log('To execute live broadcast on Avalanche Fuji, re-run with --broadcast flag.');
    return;
  }

  console.log('\n[Passkey Deploy For Owner] Step 1: Deploying GuardedTreasury owned by PasskeyAuthority...');
  const treasuryDeployTx = await walletClient.deployContract({
    abi: treasuryArtifact.abi,
    bytecode: treasuryArtifact.bytecode.object as Hex,
    args: [
      FUJI_USDC_ADDRESS,
      predictedAuthority,
      5_000_000n,  // perTxCap 5 USDC
      20_000_000n, // dailyCap 20 USDC
      10_000_000n, // missionCap 10 USDC
    ],
  });

  console.log(`  Treasury Deploy Tx: ${treasuryDeployTx}`);
  const treasuryReceipt = await publicClient.waitForTransactionReceipt({ hash: treasuryDeployTx });
  const treasuryAddress = treasuryReceipt.contractAddress!;
  console.log(`  GuardedTreasury deployed at: ${treasuryAddress} (block #${treasuryReceipt.blockNumber}, gasUsed: ${treasuryReceipt.gasUsed})`);

  console.log('\n[Passkey Deploy For Owner] Step 2: Deploying PasskeyMissionAuthority (PK-F1 Hardened)...');
  const authorityDeployTx = await walletClient.deployContract({
    abi: authorityArtifact.abi,
    bytecode: authorityArtifact.bytecode.object as Hex,
    args: [treasuryAddress, passkeyX, passkeyY, rpIdHash, originArg, requireUV],
  });

  console.log(`  Authority Deploy Tx: ${authorityDeployTx}`);
  const authorityReceipt = await publicClient.waitForTransactionReceipt({ hash: authorityDeployTx });
  const authorityAddress = authorityReceipt.contractAddress!;
  console.log(`  PasskeyMissionAuthority deployed at: ${authorityAddress} (block #${authorityReceipt.blockNumber}, gasUsed: ${authorityReceipt.gasUsed})`);

  if (authorityAddress.toLowerCase() !== predictedAuthority.toLowerCase()) {
    throw new Error(`Address prediction mismatch: expected ${predictedAuthority}, deployed ${authorityAddress}`);
  }

  console.log('\n[DEPLOYMENT SUCCESSFUL] Passkey Authority ready for biometric approvals.');
  console.log(`  Passkey Authority: ${authorityAddress}`);
  console.log(`  Guarded Treasury:  ${treasuryAddress}`);
}

main().catch((err) => {
  console.error('[Passkey Deploy For Owner Error]', err.message || err);
  process.exit(1);
});
