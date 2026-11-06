import { normalizeAddress } from './chain';
import { privateKeyToAccount } from 'viem/accounts';

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
