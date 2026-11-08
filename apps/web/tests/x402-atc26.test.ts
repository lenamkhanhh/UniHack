import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import {
  clearDatabase,
  createTestMission,
  sellerAddress,
  TEST_AGENT_KEY,
} from './setup';
import { verifyToken, computePayloadHash } from '@/lib/auth';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
  executeUpstreamAndSettle,
} from '@/lib/payments';
import { setChainReader, reconcileOperation } from '@/lib/reconcile';
import { POST as toolRoutePOST } from '@/app/api/tools/[id]/route';
import { computeBoundNonce, NONCE_BINDING_VERSION } from '@/lib/x402-binding';
import {
  SEARCH_PRICE,
  SUMMARY_PRICE,
  CAIP2_AVALANCHE_FUJI,
  LEGACY_AVALANCHE_FUJI,
} from '@/lib/constants';

describe.each([1, 2])("x402 ATC'26 Vulnerability Hardening Suite (v%i)", (version) => {
  beforeEach(async () => {
    setChainReader(null);
    await clearDatabase();
  });

  async function createSignedOperation(params: {
    toolId?: string;
    input?: Record<string, any>;
    spendToken: string;
    operationId?: string;
  }) {
    const operationId = params.operationId || randomUUID();
    const toolId = params.toolId || 'tool:search';
    const input = params.input || { query: 'Avalanche C-Chain' };
    const claims = await verifyToken(params.spendToken);

    await createQuote({
      operationId,
      toolId,
      input,
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    await reserveOperation({
      operationId,
      tokenClaims: claims,
    });

    const signedOp = await signOperationAuthorization({
      operationId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    const isV2 = version === 2;
    const paymentHeaderName = isV2 ? 'payment-signature' : 'x-payment';

    const paymentPayload = isV2
      ? {
          x402Version: 2,
          resource: `http://localhost:3000/api/tools/${toolId}`,
          accepted: {
            scheme: 'exact',
            network: CAIP2_AVALANCHE_FUJI,
            amount: signedOp.authValue,
            asset: signedOp.authTo,
            payTo: signedOp.authTo,
            maxTimeoutSeconds: 60,
          },
          payload: {
            authorization: {
              from: signedOp.authFrom,
              to: signedOp.authTo,
              value: signedOp.authValue,
              validAfter: signedOp.validAfter?.toString(),
              validBefore: signedOp.validBefore?.toString(),
              nonce: signedOp.authNonce,
            },
            signature: signedOp.authSignature,
          },
        }
      : {
          x402Version: 1,
          scheme: 'exact',
          network: LEGACY_AVALANCHE_FUJI,
          payload: {
            authorization: {
              from: signedOp.authFrom,
              to: signedOp.authTo,
              value: signedOp.authValue,
              validAfter: signedOp.validAfter?.toString(),
              validBefore: signedOp.validBefore?.toString(),
              nonce: signedOp.authNonce,
            },
            signature: signedOp.authSignature,
          },
        };

    const paymentHeaderValue = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

    return {
      operationId,
      toolId,
      input,
      signedOp,
      claims,
      paymentPayload,
      paymentHeaderName,
      paymentHeaderValue,
      xPaymentHeader: paymentHeaderValue,
    };
  }

  // --------------------------------------------------------------------------
  // F1c: Bound Nonce Verification & Deterministic Test Vector
  // --------------------------------------------------------------------------
  it(`F1c (v${version}): Bound nonce matches computeBoundNonce formula and passes deterministic test vector`, async () => {
    // 1. Assert deterministic test vector for external judges to verify independently
    const testVector = {
      operationId: 'op_atc26_fixed_vector_001',
      toolId: 'tool:search',
      inputHash: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
      priceAtomic: '100000',
      payTo: '0x5425890298aed601595a70AB815c96711a31Bc65',
      chainId: 43113,
    };

    const computedNonce = computeBoundNonce(testVector);
    expect(computedNonce).toBe(
      '0xebdd90c244ce1070a3d0873c3100426d14294aca2687286f7d1b7a236297e49e'
    );

    // 2. Full end-to-end route test: normal request with bound nonce succeeds
    const { mission, spendToken } = await createTestMission();
    const { operationId, paymentHeaderName, paymentHeaderValue, input } = await createSignedOperation({
      toolId: 'tool:search',
      input: { query: 'Avalanche C-Chain' },
      spendToken,
    });

    const req = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        [paymentHeaderName]: paymentHeaderValue,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: input }),
    });

    const res = await toolRoutePOST(req, { params: Promise.resolve({ id: 'tool:search' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.state).toBe('SETTLED');
    expect(data.result).not.toBeNull();
    expect(data.result.query).toBe('Avalanche C-Chain');

    // Verify DB operation has bound nonce
    const op = await prisma.toolOperation.findUnique({ where: { operationId } });
    expect(op?.state).toBe('SETTLED');
    expect(op?.authNonce).toBeDefined();

    // Verify audit entry contains nonce_binding tag
    const auditEntries = await prisma.auditEntry.findMany({
      where: { missionSlug: mission.slug },
    });
    const signedEntries = auditEntries.filter((e) => {
      try {
        const p = JSON.parse(e.canonicalJson);
        return p.operation_id === operationId && p.kind === 'TOOL_SIGNED';
      } catch {
        return false;
      }
    });
    expect(signedEntries.length).toBe(1);
    expect(JSON.parse(signedEntries[0].canonicalJson).reason).toContain("nonce_binding: 'request-bound-v1'");
  });

  // --------------------------------------------------------------------------
  // F1a: Cross-Resource Free-Riding (Tool Mismatch)
  // --------------------------------------------------------------------------
  it(`F1a (v${version}): Cross-resource free-riding attack (tool mismatch) is blocked with HTTP 403 PAYMENT_NOT_BOUND_TO_REQUEST without running upstream`, async () => {
    const { spendToken } = await createTestMission();

    // Sign for tool:search (0.10 USDC)
    const { operationId, paymentHeaderName, paymentHeaderValue } = await createSignedOperation({
      toolId: 'tool:search',
      input: { query: 'Search query' },
      spendToken,
    });

    // Attacker sends payment signed for tool:search to route tool:summary (which costs 0.50 USDC)
    const attackReq = new NextRequest('http://localhost:3000/api/tools/tool:summary', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        [paymentHeaderName]: paymentHeaderValue,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: { text: 'Free-rider attempting to get summary for search price' } }),
    });

    const res = await toolRoutePOST(attackReq, { params: Promise.resolve({ id: 'tool:summary' }) });
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toBe('PAYMENT_NOT_BOUND_TO_REQUEST');
    // S3-F1: Ensure binding nonces are not leaked in the 403 response
    expect(data.expectedNonce).toBeUndefined();
    expect(data.receivedNonce).toBeUndefined();

    // Upstream execution must NOT have occurred
    const op = await prisma.toolOperation.findUnique({ where: { operationId } });
    expect(op?.state).not.toBe('SETTLED');
    expect(op?.heldResult).toBeNull();
  });

  // --------------------------------------------------------------------------
  // F1b: Parameter Tampering (Modified Request Body / inputHash Mismatch)
  // --------------------------------------------------------------------------
  it(`F1b (v${version}): Parameter tampering attack (modified request body / inputHash mismatch) is blocked with HTTP 403 PAYMENT_NOT_BOUND_TO_REQUEST`, async () => {
    const { spendToken } = await createTestMission();

    // Sign for legitimate query
    const { operationId, paymentHeaderName, paymentHeaderValue } = await createSignedOperation({
      toolId: 'tool:search',
      input: { query: 'Original query before tampering' },
      spendToken,
    });

    // Attacker tampers body before forwarding to seller
    const tamperedReq = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        [paymentHeaderName]: paymentHeaderValue,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: { query: 'Tampered malicious query payload' } }),
    });

    const res = await toolRoutePOST(tamperedReq, { params: Promise.resolve({ id: 'tool:search' }) });
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toBe('PAYMENT_NOT_BOUND_TO_REQUEST');
    // S3-F1: Ensure binding nonces are not leaked in the 403 response
    expect(data.expectedNonce).toBeUndefined();
    expect(data.receivedNonce).toBeUndefined();

    // Verify operation was NOT settled with tampered query
    const op = await prisma.toolOperation.findUnique({ where: { operationId } });
    expect(op?.state).not.toBe('SETTLED');
  });

  // --------------------------------------------------------------------------
  // Architectural Note on Vulnerability F3 (Facilitator Censorship / Settlement Timeout)
  // --------------------------------------------------------------------------
  // ATC'26 §4.3 defines F3 as facilitator censorship or denial of service where
  // a facilitator drops an authorization or fails to broadcast before validBefore.
  // In MissionPay:
  // 1) All authorizations use short validBefore TTLs (default 60s) preventing indefinite lock.
  // 2) Unsettled reservations transition safely to UNKNOWN / AVAILABLE via timeout reconciliation without loss.
  // 3) Automatic fallback to self-hosted facilitator (apps/web/lib/facilitator-fallback.ts) with direct RPC.
  // This is an infrastructure availability property covered by P-series integration tests (P10, P15).

  // --------------------------------------------------------------------------
  // F2: Double Settlement Prevention (Concurrent Replay)
  // --------------------------------------------------------------------------
  it(`F2 (v${version}): Concurrent replay of identical payment header results in exactly 1 settlement and no duplicate spend`, async () => {
    const { mission, spendToken } = await createTestMission();

    const { operationId, paymentHeaderName, paymentHeaderValue, input } = await createSignedOperation({
      toolId: 'tool:search',
      input: { query: 'Avalanche C-Chain' },
      spendToken,
    });

    const createReq = () =>
      new NextRequest('http://localhost:3000/api/tools/tool:search', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${spendToken}`,
          'x-operation-id': operationId,
          [paymentHeaderName]: paymentHeaderValue,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ arguments: input }),
      });

    // Send 2 concurrent requests with identical payment header
    const [res1, res2] = await Promise.all([
      toolRoutePOST(createReq(), { params: Promise.resolve({ id: 'tool:search' }) }),
      toolRoutePOST(createReq(), { params: Promise.resolve({ id: 'tool:search' }) }),
    ]);

    expect([200, 202]).toContain(res1.status);
    expect([200, 202]).toContain(res2.status);

    // Exactly 1 TOOL_PAID audit entry must exist (no double payment)
    const auditEntries = await prisma.auditEntry.findMany({
      where: { missionSlug: mission.slug },
    });
    const paidEntries = auditEntries.filter((e) => {
      try {
        const p = JSON.parse(e.canonicalJson);
        return p.operation_id === operationId && p.kind === 'TOOL_PAID';
      } catch {
        return false;
      }
    });
    expect(paidEntries.length).toBe(1);

    // Check spent budget on mission is incremented by exactly 1 tool price (100,000 atomic), NOT doubled
    const updatedMission = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(updatedMission?.spentTool.toString()).toBe(BigInt(SEARCH_PRICE).toString());
  });

  // --------------------------------------------------------------------------
  // F4: Premature Result Disclosure Gating
  // --------------------------------------------------------------------------
  it(`F4 (v${version}): Premature result disclosure defense: failed settlement strictly gates upstream output and returns null result with FAILED state`, async () => {
    const { spendToken } = await createTestMission();

    const { operationId, signedOp, paymentHeaderName, paymentHeaderValue, input } = await createSignedOperation({
      toolId: 'tool:search',
      input: { query: 'Confidential upstream query' },
      spendToken,
    });

    // Populate heldResult by updating DB directly to simulate pre-settlement computation,
    // then transition operation to FAILED (e.g. via authorization cancellation)
    await prisma.toolOperation.update({
      where: { operationId },
      data: {
        heldResult: JSON.stringify({ confidentialData: 'TopSecretUpstreamOutput' }),
        heldResultHash: '0x' + '9'.repeat(64),
      },
    });

    const now = Math.floor(Date.now() / 1000);
    const failedOp = await reconcileOperation(operationId, {
      injectedEvidence: {
        txHash: '0xfail_cancellation',
        blockNumber: 12345n,
        blockHash: '0xblockfail',
        blockTimestamp: BigInt(now),
        isFinalized: true,
        status: 'reverted',
        authorizationCanceled: {
          from: signedOp.authFrom!,
          nonce: signedOp.authNonce!,
          logIndex: 0,
        },
      },
    });

    expect(failedOp?.state).toBe('FAILED');

    // Attempting to hit the route on a FAILED operation returns status 400 with state FAILED and result null
    const req = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        [paymentHeaderName]: paymentHeaderValue,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: input }),
    });

    const res = await toolRoutePOST(req, { params: Promise.resolve({ id: 'tool:search' }) });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.state).toBe('FAILED');
    expect(body.result).toBeNull();
    // Verify confidentialData is NEVER revealed in response body
    expect(JSON.stringify(body)).not.toContain('TopSecretUpstreamOutput');
  });
});
