import { randomBytes, randomUUID } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { prisma, withLockOrder } from './db';
import { appendAuditEntry } from './audit';
import { toolCatalog, getCanonicalPaymentTerms } from './tools';
import {
  CHAIN_ID,
  USDC_ADDRESS,
  QUOTE_TTL_SECONDS,
  RESERVATION_TTL_SECONDS,
  AUTHORIZATION_TTL_SECONDS,
  X402_VERSION,
  X402_SCHEME,
  FACILITATOR_DEFAULT_URL,
} from './constants';
import {
  normalizeAddress,
  usdcEip712Domain,
  eip3009Types,
} from './chain';
import { canonicalJson, computePayloadHash, TokenClaims } from './auth';
import { reconcileOperation, ChainEvidence } from './reconcile';
import { getPaymentMode } from './config';

export { getPaymentMode };

export interface QuoteParams {
  operationId: string;
  toolId: string;
  input: Record<string, any>;
  tokenClaims: TokenClaims;
  sellerAddress: string;
  appOrigin: string;
  sessionId?: string;
  minuteIndex?: number;
}

export async function createQuote(params: QuoteParams) {
  if (params.tokenClaims.type !== 'spend') {
    throw new Error('Spend token required to create a quote');
  }

  const tool = toolCatalog[params.toolId];
  if (!tool) {
    throw new Error(`Tool ${params.toolId} not found`);
  }

  const argCheck = tool.validateInput(params.input);
  if (!argCheck.valid) {
    throw new Error(argCheck.error || 'Invalid arguments');
  }

  const inputHash = computePayloadHash(argCheck.canonicalInput);
  const paymentTerms = getCanonicalPaymentTerms({
    toolId: params.toolId,
    priceAtomic: tool.priceAtomic,
    sellerAddress: params.sellerAddress,
    appOrigin: params.appOrigin,
    policyVersion: params.tokenClaims.missionConfigVersion,
  });
  const paymentTermsJson = canonicalJson(paymentTerms);
  const paymentTermsHash = computePayloadHash(paymentTerms);

  const now = new Date();
  const quoteExpiresAt = new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000);

  // Check if operation already exists (idempotency, 02 §5)
  const existing = await prisma.toolOperation.findUnique({
    where: { operationId: params.operationId },
  });

  if (existing) {
    if (
      existing.toolId !== params.toolId ||
      existing.inputHash !== inputHash ||
      existing.missionSlug !== params.tokenClaims.missionSlug
    ) {
      throw new Error('OPERATION_SCOPE_MISMATCH');
    }
    return {
      operation: existing,
      unpaidResponse: build402Response(existing, params.appOrigin),
    };
  }

  const operation = await prisma.toolOperation.create({
    data: {
      operationId: params.operationId,
      deploymentId: params.tokenClaims.deploymentId,
      missionSlug: params.tokenClaims.missionSlug,
      paymentMode: getPaymentMode(),
      payerAddress: normalizeAddress(params.tokenClaims.agent),
      toolId: params.toolId,
      inputHash,
      paymentTerms: paymentTermsJson,
      paymentTermsHash,
      policyHash: params.tokenClaims.policyHash,
      chainId: CHAIN_ID,
      asset: normalizeAddress(USDC_ADDRESS),
      state: 'CREATED',
      version: 0,
      authDeploymentVersion: params.tokenClaims.authVersion,
      quoteExpiresAt,
      reservedAmount: '0',
      sessionId: params.sessionId,
      minuteIndex: params.minuteIndex,
    },
  });

  return {
    operation,
    unpaidResponse: build402Response(operation, params.appOrigin),
  };
}

export function build402Response(operation: any, appOrigin: string) {
  const terms = JSON.parse(operation.paymentTerms);
  return {
    x402Version: X402_VERSION,
    error: 'X-PAYMENT header is required',
    accepts: [
      {
        scheme: X402_SCHEME,
        network: 'avalanche-fuji',
        maxAmountRequired: terms.priceAtomic,
        asset: terms.asset,
        payTo: terms.payTo,
        resource: terms.resource,
        description: `Purchase for ${operation.toolId}`,
        mimeType: 'application/json',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
    operationId: operation.operationId,
  };
}

export async function reserveOperation(params: {
  operationId: string;
  tokenClaims: TokenClaims;
}) {
  if (params.tokenClaims.type !== 'spend') {
    throw new Error('Spend token required for reservation');
  }

  const opPre = await prisma.toolOperation.findUnique({
    where: { operationId: params.operationId },
    select: { operationId: true, missionSlug: true, sessionId: true },
  });

  if (!opPre || opPre.missionSlug !== params.tokenClaims.missionSlug) {
    throw new Error('OPERATION_NOT_FOUND');
  }

  return await withLockOrder(
    async (tx) => {
      const op = await tx.toolOperation.findUnique({
        where: { operationId: params.operationId },
      });

      if (!op || op.missionSlug !== params.tokenClaims.missionSlug) {
        throw new Error('OPERATION_NOT_FOUND');
      }

      if (op.state !== 'CREATED') {
        // Idempotent return if already reserved or beyond
        return op;
      }

      const now = new Date();
      if (now > op.quoteExpiresAt) {
        throw new Error('QUOTE_EXPIRED');
      }

      // Check SystemState pause / maintenance / authVersion (Finding F3)
      const state = await tx.systemState.findUnique({ where: { id: 1 } });
      if (!state || state.systemPaused || state.maintenance) {
        throw new Error('SYSTEM_PAUSED');
      }
      if (state.authVersion !== params.tokenClaims.authVersion) {
        throw new Error('AUTH_VERSION_MISMATCH');
      }

      const mission = await tx.mission.findUnique({
        where: { slug: op.missionSlug },
      });

      if (!mission || mission.status !== 'ACTIVE' || now >= mission.expiresAt) {
        throw new Error('MISSION_NOT_ACTIVE_OR_EXPIRED');
      }

      if (mission.configVersion !== params.tokenClaims.missionConfigVersion) {
        throw new Error('MISSION_CONFIG_VERSION_MISMATCH');
      }

      const terms = JSON.parse(op.paymentTerms);
      const price = BigInt(terms.priceAtomic);

      const availableMission =
        BigInt(mission.toolCap.toString()) -
        BigInt(mission.spentTool.toString()) -
        BigInt(mission.reservedTool.toString());

      if (price > availableMission) {
        throw new Error('INSUFFICIENT_MISSION_TOOL_BUDGET');
      }

      if (op.sessionId) {
        const session = await tx.toolSession.findUnique({
          where: { id: op.sessionId },
        });
        if (!session || session.status !== 'ACTIVE') {
          throw new Error('SESSION_NOT_ACTIVE');
        }
        const availableSession =
          BigInt(session.cap.toString()) -
          BigInt(session.spent.toString()) -
          BigInt(session.reserved.toString());

        if (price > availableSession) {
          throw new Error('INSUFFICIENT_SESSION_BUDGET');
        }

        await tx.toolSession.update({
          where: { id: op.sessionId },
          data: { reserved: { increment: price.toString() } },
        });
      }

      const reservationExpiresAt = new Date(
        now.getTime() + RESERVATION_TTL_SECONDS * 1000
      );

      await tx.mission.update({
        where: { slug: op.missionSlug },
        data: { reservedTool: { increment: price.toString() } },
      });

      const updated = await tx.toolOperation.update({
        where: { operationId: params.operationId },
        data: {
          state: 'RESERVED',
          reservedAmount: price.toString(),
          reservationExpiresAt,
          version: { increment: 1 },
        },
      });

      await appendAuditEntry(tx, {
        actor: op.payerAddress,
        amount: price.toString(),
        chain_id: op.chainId.toString(),
        kind: 'TOOL_RESERVED',
        mission_id: op.missionSlug,
        operation_id: op.operationId,
        policy_hash: op.policyHash,
        policy_version: '1',
        reason: 'Budget reserved atomically',
        result_hash: '',
        rule: 'RESERVE_OK',
        source_key: `${op.operationId}:reserve`,
        to: terms.payTo,
        tx_hash: '',
      });

      return updated;
    },
    {
      missionSlug: opPre.missionSlug,
      sessionId: opPre.sessionId || undefined,
      operationId: params.operationId,
      lockAuditHead: true,
    }
  );
}

export async function signOperationAuthorization(params: {
  operationId: string;
  agentPrivateKey?: `0x${string}`;
  tokenClaims?: TokenClaims;
}) {
  const opPre = await prisma.toolOperation.findUnique({
    where: { operationId: params.operationId },
    select: { operationId: true, missionSlug: true, sessionId: true },
  });

  if (!opPre) {
    throw new Error('OPERATION_NOT_FOUND');
  }

  return await withLockOrder(
    async (tx) => {
      const op = await tx.toolOperation.findUnique({
        where: { operationId: params.operationId },
      });

      if (!op) {
        throw new Error('OPERATION_NOT_FOUND');
      }

      // If already signed, return existing immutable authorization (02 §3, P4, P12)
      if (
        op.state === 'SIGNED' ||
        op.state === 'SUBMITTING' ||
        op.state === 'SETTLING' ||
        op.state === 'UNKNOWN' ||
        op.state === 'SETTLED'
      ) {
        return op;
      }

      if (op.state !== 'RESERVED') {
        throw new Error(`Cannot sign operation in state ${op.state}`);
      }

      const now = new Date();
      if (op.reservationExpiresAt && now > op.reservationExpiresAt) {
        throw new Error('RESERVATION_EXPIRED');
      }

      // Re-check SystemState and Mission before signing (Finding F3)
      const state = await tx.systemState.findUnique({ where: { id: 1 } });
      if (!state || state.systemPaused || state.maintenance) {
        throw new Error('SYSTEM_PAUSED');
      }
      if (state.authVersion !== op.authDeploymentVersion) {
        throw new Error('AUTH_VERSION_MISMATCH');
      }

      const mission = await tx.mission.findUnique({
        where: { slug: op.missionSlug },
      });
      if (!mission || mission.status !== 'ACTIVE' || now >= mission.expiresAt) {
        throw new Error('MISSION_NOT_ACTIVE_OR_EXPIRED');
      }

      const terms = JSON.parse(op.paymentTerms);
      const value = BigInt(terms.priceAtomic);

      // Generate 32-byte CSPRNG nonce
      const nonce = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const validAfter = BigInt(nowSeconds - 10); // clock skew tolerance
      const validBefore = BigInt(nowSeconds + AUTHORIZATION_TTL_SECONDS);

      const mode = (op as any).paymentMode || getPaymentMode();

      let signature = 'mock_signature_for_testing';
      if (mode === 'LIVE_FUJI' && !params.agentPrivateKey) {
        throw new Error('AGENT_PRIVATE_KEY is required for signing in LIVE_FUJI mode');
      }

      if (params.agentPrivateKey) {
        const account = privateKeyToAccount(params.agentPrivateKey);
        signature = await account.signTypedData({
          domain: usdcEip712Domain,
          types: eip3009Types,
          primaryType: 'TransferWithAuthorization',
          message: {
            from: account.address,
            to: terms.payTo as `0x${string}`,
            value,
            validAfter,
            validBefore,
            nonce,
          },
        });
      }

      const updated = await tx.toolOperation.update({
        where: { operationId: params.operationId },
        data: {
          state: 'SIGNED',
          authFrom: normalizeAddress(op.payerAddress),
          authTo: normalizeAddress(terms.payTo),
          authValue: value.toString(),
          authNonce: nonce.toLowerCase(),
          validAfter,
          validBefore,
          authSignature: signature,
          version: { increment: 1 },
        },
      });

      await appendAuditEntry(tx, {
        actor: op.payerAddress,
        amount: value.toString(),
        chain_id: op.chainId.toString(),
        kind: 'TOOL_SIGNED',
        mission_id: op.missionSlug,
        operation_id: op.operationId,
        policy_hash: op.policyHash,
        policy_version: '1',
        reason: 'EIP-3009 authorization created and persisted before transmission',
        result_hash: '',
        rule: 'SIGN_OK',
        source_key: `${op.operationId}:sign`,
        to: terms.payTo,
        tx_hash: '',
      });

      return updated;
    },
    {
      missionSlug: opPre.missionSlug,
      sessionId: opPre.sessionId || undefined,
      operationId: params.operationId,
      lockAuditHead: true,
    }
  );
}

export async function executeUpstreamAndSettle(params: {
  operationId: string;
  arguments: Record<string, any>;
  claims?: TokenClaims;
  toolId?: string;
  skipUpstreamError?: boolean;
}) {
  const op = await prisma.toolOperation.findUnique({
    where: { operationId: params.operationId },
  });

  if (!op) {
    throw new Error('OPERATION_NOT_FOUND');
  }

  // Scoped check (Finding F2)
  if (params.claims && op.missionSlug !== params.claims.missionSlug) {
    throw new Error('OPERATION_NOT_FOUND');
  }

  if (params.toolId && op.toolId !== params.toolId) {
    throw new Error('OPERATION_SCOPE_MISMATCH');
  }

  if (op.state === 'SETTLED') {
    return {
      operation: op,
      result: JSON.parse(op.heldResult || '{}'),
      mode: (op as any).paymentMode || getPaymentMode(),
    };
  }

  if (op.state === 'FAILED') {
    throw new Error('Cannot execute terminal FAILED operation');
  }

  if (op.state === 'CREATED' || op.state === 'RESERVED') {
    throw new Error(`Cannot execute operation in state ${op.state}: must be SIGNED before execution`);
  }

  const tool = toolCatalog[op.toolId];
  if (!tool) {
    throw new Error(`Tool ${op.toolId} not found`);
  }

  // 1. Validate arguments and verify input hash matches stored immutable inputHash
  const argCheck = tool.validateInput(params.arguments);
  if (!argCheck.valid) {
    throw new Error(argCheck.error || 'UPSTREAM_EXECUTION_FAILED');
  }

  const computedInputHash = computePayloadHash(argCheck.canonicalInput);
  if (computedInputHash !== op.inputHash) {
    throw new Error('OPERATION_SCOPE_MISMATCH');
  }

  // Terminal states cannot be executed again (V4-01)
  if (op.state === 'SETTLED') {
    return {
      operation: op,
      result: op.heldResult ? JSON.parse(op.heldResult) : null,
      mode: (op as any).paymentMode || getPaymentMode(),
    };
  }
  if (op.state === 'FAILED') {
    return {
      operation: op,
      result: null,
      mode: (op as any).paymentMode || getPaymentMode(),
    };
  }

  // 2. Upstream execution with fencing / worker lease (Finding F7, R02, T01, V4-01)
  let result: any;
  const leaseOwner = randomUUID();
  const now = new Date();

  if (op.heldResult) {
    result = JSON.parse(op.heldResult);

    // If another worker currently holds an active submission lease, DO NOT SUBMIT! (V4-01)
    if (
      op.state === 'SUBMITTING' &&
      op.workerLeaseOwner &&
      op.workerLeaseUntil &&
      op.workerLeaseUntil.getTime() >= now.getTime()
    ) {
      return {
        operation: op,
        result: null,
        mode: (op as any).paymentMode || getPaymentMode(),
      };
    }

    // If state is UNKNOWN and candidate tx is known, try recovery/reconciliation first (V4-01)
    if (op.state === 'UNKNOWN' && (op.txHash || op.facilitatorTxHash)) {
      const reconciled = await reconcileOperation(params.operationId);
      if (reconciled && (reconciled.state === 'SETTLED' || reconciled.state === 'FAILED')) {
        return {
          operation: reconciled,
          result: reconciled.state === 'SETTLED' && reconciled.heldResult ? JSON.parse(reconciled.heldResult) : null,
          mode: (reconciled as any).paymentMode || (op as any).paymentMode || getPaymentMode(),
        };
      }
    }

    // Atomically claim submission lease across any non-terminal state (SIGNED, SUBMITTING, UNKNOWN)
    const claim = await prisma.toolOperation.updateMany({
      where: {
        operationId: params.operationId,
        state: { in: ['SIGNED', 'SUBMITTING', 'UNKNOWN'] },
        OR: [
          { workerLeaseUntil: null },
          { workerLeaseUntil: { lt: now } },
        ],
      },
      data: {
        state: 'SUBMITTING',
        workerLeaseOwner: leaseOwner,
        workerLeaseUntil: new Date(now.getTime() + 30000),
        submissionStartedAt: now,
        workerLeaseGeneration: { increment: 1 },
        version: { increment: 1 },
      },
    });

    if (claim.count === 0) {
      // Failed to claim active lease: another worker claimed it or state transitioned
      const current = await prisma.toolOperation.findUnique({
        where: { operationId: params.operationId },
      });
      if (!current) throw new Error('Operation not found');
      const isSettled = current.state === 'SETTLED';
      return {
        operation: current,
        result: isSettled && current.heldResult ? JSON.parse(current.heldResult) : null,
        mode: (current as any).paymentMode || (op as any).paymentMode || getPaymentMode(),
      };
    }
  } else {
    const leaseDurationMs = 30000;
    const leaseUntil = new Date(now.getTime() + leaseDurationMs);

    // Atomic CAS claim lease: only transition if SIGNED and not actively leased (T01)
    const claim = await prisma.toolOperation.updateMany({
      where: {
        operationId: params.operationId,
        state: 'SIGNED',
        OR: [
          { workerLeaseUntil: null },
          { workerLeaseUntil: { lt: now } },
        ],
      },
      data: {
        workerLeaseOwner: leaseOwner,
        workerLeaseUntil: leaseUntil,
        submissionStartedAt: now,
        workerLeaseGeneration: { increment: 1 },
        version: { increment: 1 },
      },
    });

    if (claim.count === 0) {
      // Another concurrent worker claimed the lease or is already executing
      const current = await prisma.toolOperation.findUnique({
        where: { operationId: params.operationId },
      });
      if (!current) throw new Error('Operation not found');
      const isSettled = current.state === 'SETTLED';
      return {
        operation: current,
        result: isSettled && current.heldResult ? JSON.parse(current.heldResult) : null,
        mode: (current as any).paymentMode || (op as any).paymentMode || getPaymentMode(),
      };
    }

    try {
      result = await tool.execute(argCheck.canonicalInput);
    } catch (err: any) {
      if (!params.skipUpstreamError) {
        throw err;
      }
      result = null;
    }

    if (!result) {
      throw new Error('UPSTREAM_EXECUTION_FAILED');
    }

    const heldResult = JSON.stringify(result);
    const heldResultHash = computePayloadHash(result);

    // Persist heldResult + hash and transition to SUBMITTING before external settle (02 §4, R02, T01)
    // Fencing requires matching exact workerLeaseOwner and unexpired lease
    const persist = await prisma.toolOperation.updateMany({
      where: {
        operationId: params.operationId,
        state: 'SIGNED',
        workerLeaseOwner: leaseOwner,
        workerLeaseUntil: { gte: new Date() },
      },
      data: {
        heldResult,
        heldResultHash,
        state: 'SUBMITTING',
        submissionStartedAt: new Date(),
        workerLeaseUntil: new Date(Date.now() + 30000), // extend lease for submission window
        version: { increment: 1 },
      },
    });

    if (persist.count === 0) {
      // Fenced out! Another worker took over lease while this worker was computing.
      // Do NOT submit to facilitator!
      const current = await prisma.toolOperation.findUnique({
        where: { operationId: params.operationId },
      });
      if (!current) throw new Error('Operation not found');
      const isSettled = current.state === 'SETTLED';
      return {
        operation: current,
        result: isSettled && current.heldResult ? JSON.parse(current.heldResult) : null,
        mode: (current as any).paymentMode || (op as any).paymentMode || getPaymentMode(),
      };
    }
  }

  const mode = (op as any).paymentMode || getPaymentMode();

  if (mode === 'MOCK') {
    // S1 MOCK settlement: clearly labelled mock evidence without fake blockchain blocks/txs (Finding R13, T10)
    const mockEvidence: ChainEvidence = {
      txHash: `mock:${params.operationId}`,
      blockNumber: null,
      blockHash: null,
      blockTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      isFinalized: true,
      status: 'success' as const,
    };

    const settledOp = await reconcileOperation(params.operationId, {
      injectedEvidence: mockEvidence,
    });

    return {
      operation: settledOp,
      result,
      mode: 'MOCK' as const,
    };
  } else {
    // LIVE_FUJI mode:
    // Facilitator submission via HTTP POST to facilitatorUrl using standard x402 v1 schema (Finding R03, T08)
    const facilitatorUrl = process.env.FACILITATOR_URL || FACILITATOR_DEFAULT_URL;
    const paymentPayload = {
      x402Version: 1,
      scheme: X402_SCHEME,
      network: 'avalanche-fuji',
      payload: {
        authorization: {
          from: op.authFrom,
          to: op.authTo,
          value: op.authValue?.toString(),
          validAfter: op.validAfter?.toString(),
          validBefore: op.validBefore?.toString(),
          nonce: op.authNonce,
        },
        signature: op.authSignature,
      },
    };

    const terms = JSON.parse(op.paymentTerms || '{}');
    const paymentRequirements = {
      scheme: X402_SCHEME,
      network: 'avalanche-fuji',
      maxAmountRequired: op.authValue?.toString() || terms.priceAtomic || op.reservedAmount?.toString(),
      payTo: op.authTo || terms.payTo,
      asset: op.asset || terms.asset || USDC_ADDRESS,
      resource: terms.resource || `${process.env.APP_ORIGIN || 'http://localhost:3000'}/api/tools/${op.toolId}`,
      description: `Purchase for ${op.toolId}`,
      mimeType: 'application/json',
      maxTimeoutSeconds: terms.timeoutSeconds || 60,
      extra: { name: 'USD Coin', version: '2' },
    };

    const requestBody = {
      x402Version: 1,
      paymentPayload,
      paymentRequirements,
    };

    let facilitatorTxHash: string | null = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const resp = await fetch(`${facilitatorUrl}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (resp.ok) {
        const data = await resp.json();
        // Support standard x402 v1 "transaction" field as well as "txHash" extension (Finding R03)
        const candidateTx = data?.transaction || data?.txHash;
        if (data && data.success && candidateTx) {
          facilitatorTxHash = candidateTx;
        }
      }
    } catch {
      // Facilitator error or timeout
    }

    if (facilitatorTxHash) {
      // Transition from SUBMITTING to SETTLING using CAS (T02, V4-01)
      const submitCas = await prisma.toolOperation.updateMany({
        where: {
          operationId: params.operationId,
          state: 'SUBMITTING',
          workerLeaseOwner: leaseOwner,
        },
        data: {
          facilitatorTxHash,
          txHash: facilitatorTxHash,
          state: 'SETTLING',
          version: { increment: 1 },
        },
      });

      if (submitCas.count === 0) {
        // Lease was lost or expired during network call; attach candidate evidence without reopening terminal state (V4-01)
        await prisma.toolOperation.updateMany({
          where: {
            operationId: params.operationId,
            state: { notIn: ['SETTLED', 'FAILED'] },
            txHash: null,
          },
          data: {
            facilitatorTxHash,
            txHash: facilitatorTxHash,
            state: 'SETTLING',
          },
        });
      }

      const settledOp = await reconcileOperation(params.operationId);
      const isSettled = settledOp?.state === 'SETTLED';

      return {
        operation: settledOp,
        result: isSettled ? result : null, // Result only returned when SETTLED (Finding F4)
        mode: (settledOp as any)?.paymentMode || 'LIVE_FUJI',
      };
    } else {
      // Facilitator call failed or timed out: mark UNKNOWN ONLY if still SUBMITTING!
      // NEVER overwrite SETTLED or FAILED terminal states! (T02)
      await prisma.toolOperation.updateMany({
        where: {
          operationId: params.operationId,
          state: 'SUBMITTING',
          workerLeaseOwner: leaseOwner,
        },
        data: {
          state: 'UNKNOWN',
          failureReason: 'FACILITATOR_TIMEOUT_OR_UNAVAILABLE',
          version: { increment: 1 },
        },
      });

      const current = await prisma.toolOperation.findUnique({
        where: { operationId: params.operationId },
      });
      if (!current) throw new Error('Operation not found');

      // If already settled by concurrent process or background reconciler, return result
      const isSettled = current.state === 'SETTLED';
      return {
        operation: current,
        result: isSettled ? result : null,
        mode: (current as any).paymentMode || 'LIVE_FUJI',
      };
    }
  }
}
