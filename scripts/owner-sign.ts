/**
 * S1-1: CLI & Programmatic Owner Transaction Signer for Avalanche Fuji
 *
 * Automatically signs owner-authorized transactions for GuardedTreasury, USDC,
 * and ERC-8004 registries using DEPLOYER_PRIVATE_KEY from contracts/.env.
 *
 * SECURITY INVARIANTS:
 * - NEVER prints or logs private keys.
 * - Rejects known Anvil / Hardhat keys.
 * - Enforces chainId == 43113 (Avalanche Fuji).
 * - Target address allowlist strictly enforced (Treasury, Fuji USDC, ERC-8004).
 * - Owner address must match verified Fuji owner: 0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c.
 */

import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

export const FUJI_CHAIN_ID = 43113;
export const FUJI_RPC_URL =
  process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';

export const EXPECTED_OWNER_ADDRESS = '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c';
export const EXPECTED_AGENT_ADDRESS = '0x374b8A126FDb9e5deEc8307da385076155Af3D72';
export const GUARDED_TREASURY_ADDRESS =
  process.env.GUARDED_TREASURY_ADDRESS ||
  process.env.NEXT_PUBLIC_GUARDED_TREASURY_ADDRESS ||
  '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';
export const FUJI_USDC_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65';
export const ERC8004_IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
export const ERC8004_REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

const ALLOWED_TARGETS = new Set([
  getAddress(GUARDED_TREASURY_ADDRESS),
  getAddress(FUJI_USDC_ADDRESS),
  getAddress(ERC8004_IDENTITY_REGISTRY),
  getAddress(ERC8004_REPUTATION_REGISTRY),
  getAddress(EXPECTED_AGENT_ADDRESS),
]);

if (process.env.VALIDATOR_ADDRESS) {
  try { ALLOWED_TARGETS.add(getAddress(process.env.VALIDATOR_ADDRESS)); } catch {}
}
if (process.env.VALIDATION_REGISTRY_ADDRESS) {
  try { ALLOWED_TARGETS.add(getAddress(process.env.VALIDATION_REGISTRY_ADDRESS)); } catch {}
}

export function addAllowedTarget(addr: string): void {
  ALLOWED_TARGETS.add(getAddress(addr));
}

const INSECURE_KEYS = new Set([
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'.toLowerCase(),
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'.toLowerCase(),
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'.toLowerCase(),
]);

/**
 * Loads the deployer/owner private key in-memory without exposing it to stdout/logs.
 */
function getOwnerPrivateKey(): Hex {
  let key = process.env.DEPLOYER_PRIVATE_KEY || process.env.OWNER_PRIVATE_KEY;
  if (!key) {
    const contractsEnvPath = path.resolve(__dirname, '../contracts/.env');
    if (fs.existsSync(contractsEnvPath)) {
      const content = fs.readFileSync(contractsEnvPath, 'utf8');
      const match = content.match(/DEPLOYER_PRIVATE_KEY\s*=\s*(0x[a-fA-F0-9]{64})/);
      if (match) {
        key = match[1];
      }
    }
  }

  if (!key || !key.startsWith('0x') || key.length !== 66) {
    throw new Error('SECURITY_ERROR: Valid 32-byte DEPLOYER_PRIVATE_KEY not found in contracts/.env');
  }

  if (INSECURE_KEYS.has(key.toLowerCase())) {
    throw new Error('SECURITY_ERROR: Insecure Anvil/Hardhat test key rejected on Avalanche Fuji!');
  }

  return key as Hex;
}

export function getOwnerAccount() {
  return privateKeyToAccount(getOwnerPrivateKey());
}

export interface OwnerTxPayload {
  to: string;
  data: string;
  value?: string | bigint;
  chainId?: number | bigint;
}

export interface OwnerTxResult {
  txHash: string;
  status: 'success' | 'reverted';
  blockNumber: bigint;
  explorerUrl: string;
}

/**
 * Validates transaction parameters against Fuji security constraints.
 */
function validateTxPayload(tx: OwnerTxPayload): { to: `0x${string}`; data: `0x${string}`; value: bigint } {
  const chainId = tx.chainId ? Number(tx.chainId) : FUJI_CHAIN_ID;
  if (chainId !== FUJI_CHAIN_ID) {
    throw new Error(`SECURITY_ERROR: Target chainId must be ${FUJI_CHAIN_ID} (Avalanche Fuji), got ${chainId}`);
  }

  const checksummedTo = getAddress(tx.to);
  if (!ALLOWED_TARGETS.has(checksummedTo)) {
    throw new Error(`SECURITY_ERROR: Target address ${checksummedTo} is not in the allowed Fuji contract set.`);
  }

  const data = (tx.data ? (tx.data.startsWith('0x') ? tx.data : `0x${tx.data}`) : '0x') as `0x${string}`;
  const value = tx.value ? BigInt(tx.value) : 0n;

  return { to: checksummedTo, data, value };
}

/**
 * Signs and broadcasts an owner transaction to Avalanche Fuji, or performs dry-run.
 */
export async function signAndBroadcastOwnerTx(
  tx: OwnerTxPayload,
  options?: { dryRun?: boolean }
): Promise<OwnerTxResult> {
  const { to, data, value } = validateTxPayload(tx);
  const privateKey = getOwnerPrivateKey();
  const account = privateKeyToAccount(privateKey);

  if (account.address.toLowerCase() !== EXPECTED_OWNER_ADDRESS.toLowerCase()) {
    throw new Error(
      `SECURITY_ERROR: Key derived address ${account.address} does not match expected owner ${EXPECTED_OWNER_ADDRESS}`
    );
  }

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  if (options?.dryRun) {
    console.log(`[DRY-RUN] Simulating call to ${to} from ${account.address}...`);
    await publicClient.call({
      account: account.address,
      to,
      data,
      value,
    });
    console.log('[DRY-RUN] Simulation successful (eth_call succeeded without error).');
    return {
      txHash: '0xdry_run_simulation_success',
      status: 'success',
      blockNumber: 0n,
      explorerUrl: 'https://testnet.snowtrace.io',
    };
  }

  const walletClient = createWalletClient({
    account,
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  console.log(`[BROADCAST] Submitting owner transaction from ${account.address} to ${to}...`);
  const txHash = await walletClient.sendTransaction({
    account,
    to,
    data,
    value,
    chain: avalancheFuji,
  });

  console.log(`[TX_SUBMITTED] Hash: ${txHash}`);
  console.log(`[WAITING] Awaiting confirmation on Avalanche Fuji...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const status = receipt.status;
  const explorerUrl = `https://testnet.snowtrace.io/tx/${txHash}`;

  console.log(`[CONFIRMED] Status: ${status.toUpperCase()} (Block #${receipt.blockNumber})`);
  console.log(`[SNOWTRACE] ${explorerUrl}`);

  return {
    txHash,
    status,
    blockNumber: receipt.blockNumber,
    explorerUrl,
  };
}

// ----------------------------------------------------------------------------
// CLI Execution Entrypoint
// ----------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  let payload: OwnerTxPayload | null = null;

  // Option A: Direct flags --to 0x... --data 0x... [--value 0] [--chainId 43113]
  const toIdx = args.indexOf('--to');
  const dataIdx = args.indexOf('--data');
  if (toIdx !== -1 && args[toIdx + 1] && dataIdx !== -1 && args[dataIdx + 1]) {
    const valueIdx = args.indexOf('--value');
    const chainIdIdx = args.indexOf('--chainId');
    payload = {
      to: args[toIdx + 1],
      data: args[dataIdx + 1],
      value: valueIdx !== -1 ? args[valueIdx + 1] : '0',
      chainId: chainIdIdx !== -1 ? Number(args[chainIdIdx + 1]) : FUJI_CHAIN_ID,
    };
  }

  // Option B: JSON payload string via --tx or raw argument
  if (!payload) {
    const payloadArg = args.find((a) => a.startsWith('{') || a.startsWith('--tx='));
    let rawJson = '';
    if (payloadArg) {
      rawJson = payloadArg.startsWith('--tx=') ? payloadArg.slice(5) : payloadArg;
    } else {
      const nextArg = args[args.indexOf('--tx') + 1];
      if (nextArg) {
        rawJson = nextArg;
      }
    }

    if (rawJson) {
      try {
        let cleanJson = rawJson;
        if ((cleanJson.startsWith("'") && cleanJson.endsWith("'")) || (cleanJson.startsWith('"') && cleanJson.endsWith('"'))) {
          cleanJson = cleanJson.slice(1, -1);
        }
        cleanJson = cleanJson.replace(/\\"/g, '"');
        payload = JSON.parse(cleanJson);
      } catch (err: any) {
        console.error('Invalid JSON payload argument:', err.message);
        process.exit(1);
      }
    }
  }

  if (!payload) {
    console.log('Usage:');
    console.log('  npx tsx scripts/owner-sign.ts [--dry-run] --to <address> --data <hexData> [--value 0]');
    console.log('  npx tsx scripts/owner-sign.ts [--dry-run] --tx \'{"to":"0x...","data":"0x..."}\'');
    process.exit(0);
  }

  signAndBroadcastOwnerTx(payload, { dryRun })
    .then((res) => {
      console.log(JSON.stringify(res, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    })
    .catch((err) => {
      console.error('Owner Sign Error:', err.message || err);
      process.exit(1);
    });
}
