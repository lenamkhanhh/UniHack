import { createPublicClient, http, parseAbiItem, decodeEventLog } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { prisma, withLockOrder } from './db';
import { appendAuditEntry } from './audit';
import { normalizeAddress } from './chain';
import { RPC_URL, USDC_ADDRESS } from './constants';

export interface ChainEvidence {
  txHash: string;
  blockNumber: bigint | null;
  blockHash: string | null;
  blockTimestamp: bigint;
  isFinalized: boolean;
  status: 'success' | 'reverted';
  authorizationUsed?: {
    from: string;
    nonce: string;
    logIndex: number;
  };
  transfer?: {
    from: string;
    to: string;
    value: bigint;
    logIndex: number;
  };
  authorizationCanceled?: {
    from: string;
    nonce: string;
    logIndex: number;
  };
  nonceStateAtBlock?: boolean; // true = used/canceled, false = unused
}

/**
 * Pluggable chain verifier boundary:
 * Tests inject deterministic fakes; production / LIVE_FUJI uses real RPC reads.
 */
export type ChainReader = (params: {
  chainId: number;
  asset: string;
  authFrom: string;
  authNonce: string;
  txHash?: string | null;
  expectedTo?: string | null;
  expectedValue?: bigint | null;
}) => Promise<ChainEvidence | null>;

let globalChainReader: ChainReader | null = null;

export function setChainReader(reader: ChainReader | null) {
  globalChainReader = reader;
}

export function createProductionChainReader(rpcUrl: string = RPC_URL): ChainReader {
  return async (params) => {
    try {
      const client = createPublicClient({
        chain: avalancheFuji,
        transport: http(rpcUrl),
      });

      // Actual RPC chainId verification (Finding T09)
      const rpcChainId = await client.getChainId().catch(() => null);
      if (rpcChainId !== 43113) {
        return null;
      }

      if (!params.txHash) {
        // Query contract for authorizationState pinned to the exact block snapshot
        const latestBlock = await client.getBlock({ blockTag: 'latest' }).catch(() => null);
        if (!latestBlock) return null;

        const nonceBytes = (params.authNonce.startsWith('0x') ? params.authNonce : `0x${params.authNonce}`) as `0x${string}`;
        const isUsedOrCanceled = await client.readContract({
          address: params.asset as `0x${string}`,
          abi: [
            parseAbiItem('function authorizationState(address authorizer, bytes32 nonce) external view returns (bool)'),
          ],
          functionName: 'authorizationState',
          args: [params.authFrom as `0x${string}`, nonceBytes],
          blockNumber: latestBlock.number,
        }).catch(() => null);

        return {
          txHash: '',
          blockNumber: latestBlock.number,
          blockHash: latestBlock.hash,
          blockTimestamp: latestBlock.timestamp,
          isFinalized: true,
          status: 'success',
          nonceStateAtBlock: isUsedOrCanceled !== null ? Boolean(isUsedOrCanceled) : undefined,
        };
      }

      const hash = (params.txHash.startsWith('0x') ? params.txHash : `0x${params.txHash}`) as `0x${string}`;
      const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) {
        return null;
      }

      // Read receipt block to obtain authentic block timestamp for the receipt
      const receiptBlock = await client.getBlock({ blockHash: receipt.blockHash }).catch(() => null);
      if (!receiptBlock) {
        return null;
      }

      const status = receipt.status === 'success' ? 'success' : 'reverted';
      const isFinalized = true; // Accepted Avalanche C-chain blocks are finalized

      let authorizationUsed: ChainEvidence['authorizationUsed'] | undefined;
      let transfer: ChainEvidence['transfer'] | undefined;
      let authorizationCanceled: ChainEvidence['authorizationCanceled'] | undefined;

      const targetAsset = normalizeAddress(params.asset);
      const expectedAuthorizer = normalizeAddress(params.authFrom);
      const expectedNonce = (params.authNonce.startsWith('0x') ? params.authNonce : `0x${params.authNonce}`).toLowerCase();

      const authUsedAbi = parseAbiItem(
        'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)'
      );
      const transferAbi = parseAbiItem(
        'event Transfer(address indexed from, address indexed to, uint256 value)'
      );
      const authCanceledAbi = parseAbiItem(
        'event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)'
      );

      for (const log of receipt.logs) {
        if (normalizeAddress(log.address) !== targetAsset) {
          continue;
        }

        try {
          const decodedUsed = decodeEventLog({
            abi: [authUsedAbi],
            data: log.data,
            topics: log.topics,
          });
          if (
            decodedUsed.eventName === 'AuthorizationUsed' &&
            normalizeAddress(decodedUsed.args.authorizer) === expectedAuthorizer &&
            decodedUsed.args.nonce.toLowerCase() === expectedNonce
          ) {
            authorizationUsed = {
              from: decodedUsed.args.authorizer,
              nonce: decodedUsed.args.nonce,
              logIndex: log.logIndex,
            };
          }
        } catch {}

        try {
          const decodedTransfer = decodeEventLog({
            abi: [transferAbi],
            data: log.data,
            topics: log.topics,
          });
          if (
            decodedTransfer.eventName === 'Transfer' &&
            normalizeAddress(decodedTransfer.args.from) === expectedAuthorizer &&
            (!params.expectedTo || normalizeAddress(decodedTransfer.args.to) === normalizeAddress(params.expectedTo)) &&
            (!params.expectedValue || decodedTransfer.args.value === params.expectedValue)
          ) {
            transfer = {
              from: decodedTransfer.args.from,
              to: decodedTransfer.args.to,
              value: decodedTransfer.args.value,
              logIndex: log.logIndex,
            };
          }
        } catch {}

        try {
          const decodedCanceled = decodeEventLog({
            abi: [authCanceledAbi],
            data: log.data,
            topics: log.topics,
          });
          if (
            decodedCanceled.eventName === 'AuthorizationCanceled' &&
            normalizeAddress(decodedCanceled.args.authorizer) === expectedAuthorizer &&
            decodedCanceled.args.nonce.toLowerCase() === expectedNonce
          ) {
            authorizationCanceled = {
              from: decodedCanceled.args.authorizer,
              nonce: decodedCanceled.args.nonce,
              logIndex: log.logIndex,
            };
          }
        } catch {}
      }

      return {
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        blockTimestamp: receiptBlock.timestamp,
        isFinalized,
        status,
        authorizationUsed,
        transfer,
        authorizationCanceled,
      };
    } catch {
      return null;
    }
  };
}

export async function reconcileOperation(
  operationId: string,
  options?: {
    injectedEvidence?: ChainEvidence | null;
    currentChainTimestamp?: bigint;
  }
) {
  // 1. Resolve identifiers OUTSIDE transaction (no locks) (Finding F9)
  const opPre = await prisma.toolOperation.findUnique({
    where: { operationId },
    select: {
      operationId: true,
      missionSlug: true,
      sessionId: true,
      state: true,
      chainId: true,
      asset: true,
      authFrom: true,
      authTo: true,
      authValue: true,
      authNonce: true,
      txHash: true,
      facilitatorTxHash: true,
      quoteExpiresAt: true,
      reservationExpiresAt: true,
    },
  });

  if (!opPre) {
    return null;
  }

  // Terminal states cannot be changed
  if (opPre.state === 'SETTLED' || opPre.state === 'FAILED') {
    return await prisma.toolOperation.findUnique({ where: { operationId } });
  }

  // 2. Perform external network / chain verification OUTSIDE transaction (Finding F9)
  let evidence: ChainEvidence | null | undefined = options?.injectedEvidence;
  if (evidence === undefined) {
    const reader = globalChainReader ?? createProductionChainReader();
    evidence = await reader({
      chainId: opPre.chainId,
      asset: opPre.asset,
      authFrom: opPre.authFrom || '',
      authNonce: opPre.authNonce || '',
      txHash: opPre.txHash || opPre.facilitatorTxHash,
      expectedTo: opPre.authTo,
      expectedValue: opPre.authValue ? BigInt(opPre.authValue.toString()) : null,
    });
  }

  // 3. Strict lock ordering: mission -> session -> operation -> audit head
  return await withLockOrder(
    async (tx) => {
      const op = await tx.toolOperation.findUnique({
        where: { operationId },
        include: { mission: true, session: true },
      });

      if (!op) {
        return null;
      }

      // Re-check terminal state under lock
      if (op.state === 'SETTLED' || op.state === 'FAILED') {
        return op;
      }

      const now = new Date();

      // Case 1: Pre-authorization timeout on CREATED (no reservation)
      if (op.state === 'CREATED' && now > op.quoteExpiresAt) {
        const updated = await tx.toolOperation.update({
          where: { operationId },
          data: {
            state: 'FAILED',
            failureReason: 'QUOTE_EXPIRED_BEFORE_RESERVATION',
          },
        });
        await appendAuditEntry(tx, {
          actor: op.payerAddress,
          amount: op.reservedAmount.toString(),
          chain_id: op.chainId.toString(),
          kind: 'TOOL_FAILED',
          mission_id: op.missionSlug,
          operation_id: op.operationId,
          policy_hash: op.policyHash,
          policy_version: '1',
          reason: 'Quote expired before reservation',
          result_hash: '',
          rule: 'QUOTE_EXPIRY',
          source_key: `${op.operationId}:fail_quote_expiry`,
          to: op.authTo || '',
          tx_hash: '',
        });
        return updated;
      }

      // Case 2: Pre-authorization timeout on RESERVED without authorization
      if (
        op.state === 'RESERVED' &&
        op.reservationExpiresAt &&
        now > op.reservationExpiresAt &&
        !op.authNonce
      ) {
        const reservedAmt = BigInt(op.reservedAmount.toString());

        // Release reservation atomically
        await tx.mission.update({
          where: { slug: op.missionSlug },
          data: {
            reservedTool: { decrement: reservedAmt.toString() },
          },
        });

        if (op.sessionId) {
          await tx.toolSession.update({
            where: { id: op.sessionId },
            data: {
              reserved: { decrement: reservedAmt.toString() },
            },
          });
        }

        const updated = await tx.toolOperation.update({
          where: { operationId },
          data: {
            state: 'FAILED',
            failureReason: 'RESERVATION_EXPIRED_UNSIGNED',
            reservedAmount: '0',
          },
        });

        await appendAuditEntry(tx, {
          actor: op.payerAddress,
          amount: reservedAmt.toString(),
          chain_id: op.chainId.toString(),
          kind: 'TOOL_FAILED',
          mission_id: op.missionSlug,
          operation_id: op.operationId,
          policy_hash: op.policyHash,
          policy_version: '1',
          reason: 'Unsigned reservation expired and released',
          result_hash: '',
          rule: 'RESERVATION_TIMEOUT',
          source_key: `${op.operationId}:fail_reservation_timeout`,
          to: op.authTo || '',
          tx_hash: '',
        });

        return updated;
      }

      // Case 3: Operation has been signed (SIGNED, SUBMITTING, SETTLING, UNKNOWN)
      if (!evidence) {
        // No evidence yet; if currently SUBMITTING without candidate tx, mark UNKNOWN
        if (op.state === 'SUBMITTING' && op.authNonce) {
          return await tx.toolOperation.update({
            where: { operationId },
            data: { state: 'UNKNOWN', lastReconciledAt: now },
          });
        }
        return op;
      }

      // Reconcile according to 02 §6
      // SETTLED requirements:
      const authUsedMatches =
        evidence.authorizationUsed &&
        normalizeAddress(evidence.authorizationUsed.from) === normalizeAddress(op.authFrom || '') &&
        evidence.authorizationUsed.nonce.toLowerCase() === (op.authNonce || '').toLowerCase();

      const transferMatches =
        evidence.transfer &&
        normalizeAddress(evidence.transfer.from) === normalizeAddress(op.authFrom || '') &&
        normalizeAddress(evidence.transfer.to) === normalizeAddress(op.authTo || '') &&
        evidence.transfer.value === BigInt(op.authValue?.toString() || '0');

      const isMock = (op as any).paymentMode === 'MOCK';
      const isSettledEligible =
        evidence.status === 'success' &&
        evidence.isFinalized &&
        Boolean(op.heldResult) &&
        (isMock || (authUsedMatches && transferMatches));

      if (isSettledEligible) {
        const reservedAmt = BigInt(op.reservedAmount.toString());

        // Check if settled after pause or mission expiry
        const isPaused = op.mission.status !== 'ACTIVE' || now >= op.mission.expiresAt;
        const reason = isPaused ? 'SETTLED_AFTER_PAUSE' : 'SETTLED_NORMAL';

        // Atomically convert reserved to spent
        await tx.mission.update({
          where: { slug: op.missionSlug },
          data: {
            reservedTool: { decrement: reservedAmt.toString() },
            spentTool: { increment: reservedAmt.toString() },
          },
        });

        if (op.sessionId) {
          await tx.toolSession.update({
            where: { id: op.sessionId },
            data: {
              reserved: { decrement: reservedAmt.toString() },
              spent: { increment: reservedAmt.toString() },
            },
          });
        }

        const updated = await tx.toolOperation.update({
          where: { operationId },
          data: {
            state: 'SETTLED',
            txHash: isMock ? `mock:${operationId}` : evidence.txHash,
            receiptBlockNumber: isMock ? null : evidence.blockNumber,
            receiptBlockHash: isMock ? null : evidence.blockHash,
            authorizationLogIndex: isMock ? null : evidence.authorizationUsed?.logIndex,
            transferLogIndex: isMock ? null : evidence.transfer?.logIndex,
            lastReconciledAt: now,
            reconcileBlockNumber: isMock ? null : evidence.blockNumber,
            reconcileBlockHash: isMock ? null : evidence.blockHash,
            reconcileBlockTimestamp: evidence.blockTimestamp,
            reservedAmount: '0',
            version: { increment: 1 },
          },
        });

        await appendAuditEntry(tx, {
          actor: op.payerAddress,
          amount: reservedAmt.toString(),
          chain_id: op.chainId.toString(),
          kind: 'TOOL_PAID',
          mission_id: op.missionSlug,
          operation_id: op.operationId,
          policy_hash: op.policyHash,
          policy_version: '1',
          reason,
          result_hash: op.heldResultHash || '',
          rule: 'SETTLEMENT_VERIFIED',
          source_key: `${op.operationId}:settle`,
          to: op.authTo || '',
          tx_hash: evidence.txHash,
        });

        return updated;
      }

      // FAILED requirements:
      // 1. AuthorizationCanceled on finalized chain
      const authCanceled =
        evidence.authorizationCanceled &&
        normalizeAddress(evidence.authorizationCanceled.from) === normalizeAddress(op.authFrom || '') &&
        evidence.authorizationCanceled.nonce.toLowerCase() === (op.authNonce || '').toLowerCase();

      // 2. Finalized block timestamp >= validBefore AND nonce unused at same block
      const validBeforePassed =
        op.validBefore !== null &&
        evidence.isFinalized &&
        evidence.blockTimestamp >= op.validBefore &&
        evidence.nonceStateAtBlock === false;

      if ((authCanceled || validBeforePassed) && evidence.isFinalized) {
        const reservedAmt = BigInt(op.reservedAmount.toString());

        // Release reservation
        await tx.mission.update({
          where: { slug: op.missionSlug },
          data: {
            reservedTool: { decrement: reservedAmt.toString() },
          },
        });

        if (op.sessionId) {
          await tx.toolSession.update({
            where: { id: op.sessionId },
            data: {
              reserved: { decrement: reservedAmt.toString() },
            },
          });
        }

        const updated = await tx.toolOperation.update({
          where: { operationId },
          data: {
            state: 'FAILED',
            failureReason: authCanceled ? 'AUTHORIZATION_CANCELED' : 'AUTHORIZATION_EXPIRED_UNUSED',
            reservedAmount: '0',
            lastReconciledAt: now,
            reconcileBlockNumber: evidence.blockNumber,
            reconcileBlockHash: evidence.blockHash,
            reconcileBlockTimestamp: evidence.blockTimestamp,
          },
        });

        await appendAuditEntry(tx, {
          actor: op.payerAddress,
          amount: reservedAmt.toString(),
          chain_id: op.chainId.toString(),
          kind: 'TOOL_FAILED',
          mission_id: op.missionSlug,
          operation_id: op.operationId,
          policy_hash: op.policyHash,
          policy_version: '1',
          reason: authCanceled ? 'Authorization canceled on chain' : 'Authorization expired unused on finalized chain',
          result_hash: '',
          rule: 'SETTLEMENT_FAILED',
          source_key: `${op.operationId}:failed`,
          to: op.authTo || '',
          tx_hash: evidence.txHash || '',
        });

        return updated;
      }

      // Reverted tx or unexpired authorization -> UNKNOWN, retain reservation (02 §6, P23)
      if (evidence.status === 'reverted' || !evidence.isFinalized || (op.state === 'SUBMITTING' && Boolean(op.authNonce))) {
        return await tx.toolOperation.update({
          where: { operationId },
          data: {
            state: 'UNKNOWN',
            lastReconciledAt: now,
          },
        });
      }

      return op;
    },
    {
      missionSlug: opPre.missionSlug,
      sessionId: opPre.sessionId || undefined,
      operationId,
      lockAuditHead: true,
    }
  );
}
