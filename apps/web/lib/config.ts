import { normalizeAddress } from './chain';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { avalancheFuji } from 'viem/chains';

export function getJwtSecret(): Uint8Array {
  const secret = process.env.MISSION_TOKEN_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error('MISSION_TOKEN_SECRET is required and must be at least 32 characters long');
  }
  return new TextEncoder().encode(secret.trim());
}

export function getConfiguredOwner(): string {
  const owner = process.env.OWNER_ADDRESS;
  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner.trim())) {
    throw new Error('OWNER_ADDRESS is required and must be a valid 20-byte hex address');
  }
  return normalizeAddress(owner.trim());
}

export function getConfiguredAgentPrivateKey(): `0x${string}` | undefined {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) {
    return undefined;
  }
  const trimmed = key.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error('AGENT_PRIVATE_KEY must be a valid 32-byte hex string starting with 0x');
  }
  return trimmed as `0x${string}`;
}

export function getDeploymentId(): string {
  const id = process.env.DEPLOYMENT_ID;
  if (!id || id.trim().length === 0) {
    throw new Error('DEPLOYMENT_ID is required');
  }
  return id.trim();
}

export function getAppOrigin(): string {
  const origin = process.env.APP_ORIGIN;
  if (!origin || origin.trim().length === 0) {
    throw new Error('APP_ORIGIN is required');
  }
  return origin.trim();
}

export function getPaymentMode(): 'MOCK' | 'LIVE_FUJI' {
  const mode = process.env.PAYMENT_MODE || 'MOCK';
  const upper = mode.trim().toUpperCase();
  if (upper === 'MOCK') return 'MOCK';
  if (upper === 'LIVE_FUJI') return 'LIVE_FUJI';
  throw new Error(`Invalid PAYMENT_MODE: "${mode}". Must be MOCK or LIVE_FUJI.`);
}

export const KNOWN_INSECURE_ANVIL_ADDRESSES = new Set([
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
  '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '0x976ea74026e72cd99245227776a3ce92b0eff418',
  '0xbcd4042de499d14e55001ccbb24a551f3a940447',
  '0x71be63f3384f5fb98995898a86b02fb2426c5788',
  '0xfabb0ac9d68b0b445fb7357272ff202c5651694a',
]);

export const KNOWN_INSECURE_ANVIL_KEYS = new Set([
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b100287e90165c649ed994f43aac47f1068fc1eedf5dec8',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d7b1180d9c7c7abff8',
  '0x4bbbf856008566ac57e1e29272365cb97318d572f00f0e02329ca660d5b4f2c3',
  '0xdb0a065e6281a683a043214224d40b957647248b77054f9a562efce33f8a0022',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073746b220c22',
]);

export type BytecodeFetcher = (address: string) => Promise<string | undefined>;
let customBytecodeFetcher: BytecodeFetcher | null = null;

export function setBytecodeFetcherForTesting(fetcher: BytecodeFetcher | null) {
  customBytecodeFetcher = fetcher;
}

/**
 * Synchronous validation of LIVE_FUJI configuration parameters (format, length, insecure keys).
 */
export function validateLiveFujiConfigSync(): void {
  const mode = getPaymentMode();
  if (mode !== 'LIVE_FUJI') return;

  const seller = process.env.SELLER_ADDRESS?.trim();
  if (!seller || !/^0x[0-9a-fA-F]{40}$/.test(seller)) {
    throw new Error('KEY-02: SELLER_ADDRESS must be set to a valid 20-byte hex address when PAYMENT_MODE=LIVE_FUJI');
  }
  if (KNOWN_INSECURE_ANVIL_ADDRESSES.has(seller.toLowerCase())) {
    throw new Error('KEY-02: SELLER_ADDRESS cannot be a well-known Anvil/Hardhat test address in LIVE_FUJI mode');
  }

  const agentKey = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!agentKey || !/^0x[0-9a-fA-F]{64}$/.test(agentKey)) {
    throw new Error('KEY-02: AGENT_PRIVATE_KEY must be set to a valid 32-byte hex key when PAYMENT_MODE=LIVE_FUJI');
  }
  if (KNOWN_INSECURE_ANVIL_KEYS.has(agentKey.toLowerCase())) {
    throw new Error('KEY-02: AGENT_PRIVATE_KEY cannot be a well-known Anvil/Hardhat test private key in LIVE_FUJI mode');
  }

  const owner = process.env.OWNER_ADDRESS?.trim();
  if (owner && KNOWN_INSECURE_ANVIL_ADDRESSES.has(owner.toLowerCase())) {
    throw new Error('KEY-02: OWNER_ADDRESS cannot be a well-known Anvil/Hardhat test address in LIVE_FUJI mode');
  }

  // SW-01 Security Guard: In LIVE_FUJI mode, SESSION_WALLET_SEED must be dedicated, secure, and independent
  const sessionSeed = process.env.SESSION_WALLET_SEED?.trim();
  const tokenSecret = process.env.MISSION_TOKEN_SECRET?.trim();

  if (!sessionSeed || sessionSeed.length < 32) {
    throw new Error('SW-01: SESSION_WALLET_SEED must be set and at least 32 characters long in LIVE_FUJI mode');
  }
  if (tokenSecret && sessionSeed === tokenSecret) {
    throw new Error('SW-01: SESSION_WALLET_SEED must not be identical to MISSION_TOKEN_SECRET');
  }
  const KNOWN_INSECURE_SEEDS = new Set([
    'unihack-session-wallet-secret-dev-fallback-key-32chars',
    'test-session-wallet-seed-must-be-at-least-32-chars!',
    'test-isolated-session-wallet-seed-must-be-distinct-32chars!',
    'test-mission-token-secret-must-be-at-least-32-chars-long!',
    'your-session-wallet-seed-here-32chars-minimum-length',
  ]);
  if (KNOWN_INSECURE_SEEDS.has(sessionSeed.toLowerCase())) {
    throw new Error('SW-01: SESSION_WALLET_SEED cannot be a placeholder or well-known sample value in LIVE_FUJI mode');
  }

  // CFG-01 Security Guard: GUARDED_TREASURY_ADDRESS must be set, valid hex, non-zero, and not Anvil address
  const treasuryAddress = process.env.GUARDED_TREASURY_ADDRESS?.trim();
  if (!treasuryAddress || !/^0x[0-9a-fA-F]{40}$/.test(treasuryAddress)) {
    throw new Error('CFG-01: GUARDED_TREASURY_ADDRESS must be set to a valid 20-byte hex address when PAYMENT_MODE=LIVE_FUJI');
  }
  if (treasuryAddress.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    throw new Error('CFG-01: GUARDED_TREASURY_ADDRESS cannot be the zero address in LIVE_FUJI mode');
  }
  if (KNOWN_INSECURE_ANVIL_ADDRESSES.has(treasuryAddress.toLowerCase())) {
    throw new Error('CFG-01: GUARDED_TREASURY_ADDRESS cannot be a well-known Anvil/Hardhat test address in LIVE_FUJI mode');
  }
}

/**
 * PV-F3: Unified helper resolving GUARDED_TREASURY_ADDRESS across all routes
 */
export function getGuardedTreasuryAddress(): `0x${string}` {
  const addr = process.env.GUARDED_TREASURY_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_GUARDED_TREASURY_ADDRESS?.trim() ||
    '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3';
  return addr as `0x${string}`;
}

/**
 * KEY-02 & CFG-01 Security Guard: Validates that when operating in LIVE_FUJI mode,
 * public Anvil/Hardhat test accounts and private keys are strictly rejected, and
 * GUARDED_TREASURY_ADDRESS is a valid deployed contract with bytecode on Avalanche Fuji.
 */
export async function validateLiveFujiConfig(): Promise<void> {
  validateLiveFujiConfigSync();

  const mode = getPaymentMode();
  if (mode !== 'LIVE_FUJI') return;

  const treasuryAddress = process.env.GUARDED_TREASURY_ADDRESS?.trim()!;

  // CFG-01: Verify that GUARDED_TREASURY_ADDRESS is a deployed contract with bytecode on Avalanche Fuji
  let bytecode: string | undefined;
  if (customBytecodeFetcher) {
    bytecode = await customBytecodeFetcher(treasuryAddress);
  } else {
    try {
      const client = createPublicClient({
        chain: avalancheFuji,
        transport: http(process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc'),
      });
      bytecode = await client.getBytecode({ address: treasuryAddress as `0x${string}` });
    } catch (err: any) {
      throw new Error(`CFG-01: Failed to query bytecode for GUARDED_TREASURY_ADDRESS on Avalanche Fuji: ${err?.message || err}`);
    }
  }

  if (!bytecode || bytecode === '0x' || bytecode === '0x0') {
    throw new Error('CFG-01: GUARDED_TREASURY_ADDRESS must be a deployed contract with bytecode on Avalanche Fuji');
  }
}
