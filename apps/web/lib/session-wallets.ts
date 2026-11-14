import { privateKeyToAccount } from 'viem/accounts';
import { hkdfSync } from 'crypto';
import { normalizeAddress } from './chain';

/**
 * P1-A On-Chain Session Wallet Management (STRATEGY §4.3 & SW-01)
 *
 * Security Guarantees:
 * 1. ZERO HARDCODED FALLBACK: Requires an explicit, dedicated `SESSION_WALLET_SEED` (>= 32 chars).
 * 2. SEPARATION OF CONCERNS: Strictly prohibited from reusing `MISSION_TOKEN_SECRET` (auth secret != spending key).
 * 3. CRYPTOGRAPHIC DERIVATION: Uses HKDF-SHA256 with distinct salt (deployment ID) and mission-scoped info tag.
 * 4. LOSS BOUNDARY: In Stage S2, the session wallet is funded with exactly `toolCap` USDC on-chain.
 *    If the session key is compromised, maximum loss is strictly bounded to the mission's toolCap on-chain.
 *    The GuardedTreasury contract cannot be drained because the session wallet has no admin or treasury rights.
 */

export interface SessionWallet {
  missionSlug: string;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
}

export function getSessionWalletForMission(missionSlug: string): SessionWallet {
  const seed = process.env.SESSION_WALLET_SEED?.trim();
  if (!seed) {
    throw new Error(
      'SW-01: SESSION_WALLET_SEED environment variable is required (must be >= 32 characters, distinct from MISSION_TOKEN_SECRET)'
    );
  }
  if (seed.length < 32) {
    throw new Error('SW-01: SESSION_WALLET_SEED must be at least 32 characters long');
  }

  const tokenSecret = process.env.MISSION_TOKEN_SECRET?.trim();
  if (tokenSecret && seed === tokenSecret) {
    throw new Error('SW-01: SESSION_WALLET_SEED must not be identical to MISSION_TOKEN_SECRET');
  }

  const salt = process.env.DEPLOYMENT_ID || 'unihack-session-wallet-deployment-salt';
  const info = `session-wallet:v1:${missionSlug}`;

  // HKDF-SHA256 key derivation with distinct secret, salt, and info
  const derivedKeyBytes = hkdfSync(
    'sha256',
    Buffer.from(seed, 'utf-8'),
    Buffer.from(salt, 'utf-8'),
    Buffer.from(info, 'utf-8'),
    32
  );
  const derivedKey = `0x${Buffer.from(derivedKeyBytes).toString('hex')}` as `0x${string}`;
  const account = privateKeyToAccount(derivedKey);

  return {
    missionSlug,
    address: normalizeAddress(account.address) as `0x${string}`,
    privateKey: derivedKey,
    account,
  };
}
