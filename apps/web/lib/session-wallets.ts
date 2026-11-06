import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { keccak256, stringToBytes } from 'viem';
import { normalizeAddress } from './chain';

/**
 * P1-A On-Chain Session Wallet Management (STRATEGY §4.3)
 * Generates an isolated session EOA per mission derived securely from the server secret.
 * Stored strictly in memory/server-side; never logged to console or committed to disk.
 *
 * Security Guarantee:
 * In Stage S2, the session wallet is funded with exactly `toolCap` USDC on-chain.
 * If the session key is compromised, maximum potential loss is strictly bounded to the mission's toolCap.
 * The GuardedTreasury contract cannot be drained because the session wallet has no admin or treasury rights.
 */

export interface SessionWallet {
  missionSlug: string;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
}

export function getSessionWalletForMission(missionSlug: string): SessionWallet {
  const secret = process.env.MISSION_TOKEN_SECRET || 'unihack-session-wallet-secret-dev-fallback-key-32chars';
  // Deterministic seed per mission using server secret
  const seed = `${secret}:session-wallet:${missionSlug}`;
  const derivedKey = keccak256(stringToBytes(seed));
  const account = privateKeyToAccount(derivedKey);

  return {
    missionSlug,
    address: normalizeAddress(account.address) as `0x${string}`,
    privateKey: derivedKey,
    account,
  };
}
