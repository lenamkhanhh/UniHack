import { defineChain, getAddress, keccak256, stringToBytes } from 'viem';
import {
  CHAIN_ID,
  CHAIN_NAME,
  RPC_URL,
  EXPLORER_URL,
  USDC_ADDRESS,
  USDC_NAME,
  USDC_VERSION,
} from './constants';

export const fujiChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: {
    decimals: 18,
    name: 'Avalanche',
    symbol: 'AVAX',
  },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: 'SnowTrace', url: EXPLORER_URL },
  },
  testnet: true,
});

export const usdcEip712Domain = {
  name: USDC_NAME,
  version: USDC_VERSION,
  chainId: BigInt(CHAIN_ID),
  verifyingContract: USDC_ADDRESS as `0x${string}`,
} as const;

export const eip3009Types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export function normalizeAddress(addr: string): string {
  if (!addr) return '';
  return addr.trim().toLowerCase();
}

export function isValidAddress(addr: string): boolean {
  try {
    getAddress(addr);
    return true;
  } catch {
    return false;
  }
}

export function hashUtf8(text: string): `0x${string}` {
  return keccak256(stringToBytes(text));
}
