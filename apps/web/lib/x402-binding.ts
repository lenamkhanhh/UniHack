import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  stringToBytes,
  getAddress,
} from 'viem';

export const NONCE_BINDING_VERSION = 'MissionPay-x402-bind-v1';

export interface BoundNonceParams {
  operationId: string;
  toolId: string;
  inputHash: string;
  priceAtomic: string | bigint;
  payTo: string;
  chainId: number | bigint;
}

/**
 * Computes a deterministic EIP-3009 transfer authorization nonce bound cryptographically
 * to the exact HTTP operation, route/toolId, request body inputHash, pricing, payee, and chainId.
 *
 * Paper Reference: "Free-Riding the Agentic Web" (ATC'26, arXiv 2605.30998) - Flaw Class F1
 * (Resource Binding / Cross-Resource Free-Riding Defense).
 *
 * Formula:
 * keccak256(abi.encode(
 *   "MissionPay-x402-bind-v1",
 *   keccak256(utf8(operationId)),
 *   keccak256(utf8("POST /api/tools/" + toolId)),
 *   inputHash,
 *   priceAtomic,
 *   payTo,
 *   chainId
 * ))
 */
export function computeBoundNonce(params: BoundNonceParams): `0x${string}` {
  const normAddress = getAddress(params.payTo.trim());
  const formattedInputHash = (
    params.inputHash.startsWith('0x') ? params.inputHash : `0x${params.inputHash}`
  ) as `0x${string}`;

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('string, bytes32, bytes32, bytes32, uint256, address, uint256'),
      [
        NONCE_BINDING_VERSION,
        keccak256(stringToBytes(params.operationId)),
        keccak256(stringToBytes(`POST /api/tools/${params.toolId}`)),
        formattedInputHash,
        BigInt(params.priceAtomic),
        normAddress,
        BigInt(params.chainId),
      ]
    )
  );
}

/**
 * Verifies whether a given authorization nonce matches the expected bound nonce
 * for the specified operation parameters.
 */
export function isBoundNonceValid(
  nonce: string | undefined | null,
  params: BoundNonceParams
): boolean {
  if (!nonce) return false;
  try {
    const expected = computeBoundNonce(params);
    return nonce.trim().toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}
