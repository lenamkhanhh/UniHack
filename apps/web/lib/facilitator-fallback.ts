import {
  createPublicClient,
  createWalletClient,
  http,
  parseSignature,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { RPC_URL, USDC_ADDRESS } from './constants';

export const eip3009TransferAbi = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

export interface SelfHostedSettleParams {
  from: string;
  to: string;
  value: string | bigint;
  validAfter: string | bigint;
  validBefore: string | bigint;
  nonce: string;
  signature: string;
}

/**
 * Self-hosted x402 v2 facilitator fallback for Avalanche Fuji.
 * Used when public facilitators (Ultravioleta, PayAI) are unavailable, rate-limited,
 * or when executing dedicated deterministic settlement on Fuji.
 *
 * Guardrails:
 * - Uses dedicated FACILITATOR_PRIVATE_KEY (or RELAYER_PRIVATE_KEY).
 * - Strictly rejects owner address and treasury contract address as facilitator.
 * - Broadcasts only to USDC contract on Avalanche Fuji (Chain ID 43113).
 */
export async function settleWithSelfHostedFacilitator(
  params: SelfHostedSettleParams
): Promise<`0x${string}` | null> {
  const privateKey = (process.env.FACILITATOR_PRIVATE_KEY ||
    process.env.RELAYER_PRIVATE_KEY) as `0x${string}` | undefined;

  if (!privateKey) {
    return null;
  }

  const account = privateKeyToAccount(privateKey);
  const ownerAddr = (process.env.OWNER_ADDRESS || '').toLowerCase();
  const treasuryAddr = (process.env.GUARDED_TREASURY_ADDRESS || '').toLowerCase();

  // Strict guard: facilitator must NOT be owner or treasury
  if (account.address.toLowerCase() === ownerAddr) {
    console.warn('[FACILITATOR] Facilitator key cannot be OWNER_ADDRESS');
    return null;
  }
  if (account.address.toLowerCase() === treasuryAddr) {
    console.warn('[FACILITATOR] Facilitator key cannot be GUARDED_TREASURY_ADDRESS');
    return null;
  }

  try {
    const publicClient = createPublicClient({
      chain: avalancheFuji,
      transport: http(process.env.AVALANCHE_FUJI_RPC_URL || RPC_URL),
    });

    const walletClient = createWalletClient({
      account,
      chain: avalancheFuji,
      transport: http(process.env.AVALANCHE_FUJI_RPC_URL || RPC_URL),
    });

    const parsedSig = parseSignature(params.signature as `0x${string}`);
    const v = Number(parsedSig.v ?? (parsedSig.yParity === 1 ? 28 : 27));

    const txHash = await walletClient.writeContract({
      address: getAddress(USDC_ADDRESS),
      abi: eip3009TransferAbi,
      functionName: 'transferWithAuthorization',
      args: [
        getAddress(params.from),
        getAddress(params.to),
        BigInt(params.value),
        BigInt(params.validAfter),
        BigInt(params.validBefore),
        params.nonce as `0x${string}`,
        v,
        parsedSig.r,
        parsedSig.s,
      ],
    });

    await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 30000,
    });

    return txHash;
  } catch (err: any) {
    console.error('[FACILITATOR] Self-hosted settlement failed:', err.message || err);
    return null;
  }
}
