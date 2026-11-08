import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import {
  clearDatabase,
  createTestMission,
  sellerAddress,
  TEST_AGENT_KEY,
} from './setup';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
} from '@/lib/payments';
import { computeBoundNonce } from '@/lib/x402-binding';
import {
  CAIP2_AVALANCHE_FUJI,
  LEGACY_AVALANCHE_FUJI,
  X402_V2_REQUIRED_HEADER,
  X402_V2_SIGNATURE_HEADER,
  X402_V2_RESPONSE_HEADER,
  X402_V1_HEADER,
  X402_V1_RESPONSE_HEADER,
  SEARCH_PRICE,
} from '@/lib/constants';
import { POST as toolRoutePOST } from '@/app/api/tools/[id]/route';

describe('x402 v2 Migration & Dual-Version Protocol Suite (PLAN_MAX §M6)', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  async function createSignedV2Operation(params: {
    toolId: string;
    input: any;
    spendToken: string;
    version?: number;
  }) {
    const { toolId, input, spendToken, version = 2 } = params;
    const { verifyToken } = await import('@/lib/auth');
    const claims = await verifyToken(spendToken);
    const operationId = randomUUID();

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

    const paymentPayload = {
      x402Version: version,
      resource: `http://localhost:3000/api/tools/${toolId}`,
      accepted: {
        scheme: 'exact',
        network: CAIP2_AVALANCHE_FUJI,
        asset: signedOp.authTo,
        amount: signedOp.authValue,
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
    };

    const paymentSignatureHeader = Buffer.from(
      JSON.stringify(paymentPayload)
    ).toString('base64');

    return {
      operationId,
      toolId,
      input,
      signedOp,
      claims,
      paymentPayload,
      paymentSignatureHeader,
    };
  }

  // 1. Unpaid 402 returns v2 PAYMENT-REQUIRED header and CAIP-2 eip155:43113
  it('M6-01: Unpaid request returns 402 with PAYMENT-REQUIRED header and eip155:43113 requirement', async () => {
    const { spendToken } = await createTestMission();
    const operationId = randomUUID();

    const req = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: { query: 'Avalanche v2 protocol' } }),
    });

    const res = await toolRoutePOST(req, { params: Promise.resolve({ id: 'tool:search' }) });
    expect(res.status).toBe(402);

    const requiredHeader = res.headers.get(X402_V2_REQUIRED_HEADER);
    expect(requiredHeader).toBeDefined();
    expect(requiredHeader).not.toBeNull();

    const decoded = JSON.parse(Buffer.from(requiredHeader!, 'base64').toString('utf8'));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts).toBeDefined();
    expect(decoded.accepts[0].network).toBe(CAIP2_AVALANCHE_FUJI);
    expect(decoded.accepts[0].amount).toBe('100000');
  });

  // 2. Paid v2 request with PAYMENT-SIGNATURE succeeds and returns PAYMENT-RESPONSE
  it('M6-02: Valid PAYMENT-SIGNATURE settles and returns PAYMENT-RESPONSE header', async () => {
    const { spendToken } = await createTestMission();
    const { operationId, paymentSignatureHeader, input } = await createSignedV2Operation({
      toolId: 'tool:search',
      input: { query: 'Avalanche Fuji v2' },
      spendToken,
    });

    const req = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        [X402_V2_SIGNATURE_HEADER]: paymentSignatureHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: input }),
    });

    const res = await toolRoutePOST(req, { params: Promise.resolve({ id: 'tool:search' }) });
    expect(res.status).toBe(200);

    const v2RespHeader = res.headers.get(X402_V2_RESPONSE_HEADER);
    expect(v2RespHeader).toBeDefined();
    expect(v2RespHeader).not.toBeNull();

    const respData = JSON.parse(Buffer.from(v2RespHeader!, 'base64').toString('utf8'));
    expect(respData.x402Version).toBe(2);
    expect(respData.status).toBe('SETTLED');
    expect(respData.network).toBe(CAIP2_AVALANCHE_FUJI);

    // Also verify backward-compatible v1 response header exists
    const v1RespHeader = res.headers.get(X402_V1_RESPONSE_HEADER);
    expect(v1RespHeader).toBeDefined();

    const data = await res.json();
    expect(data.state).toBe('SETTLED');
    expect(data.result).not.toBeNull();
  });

  // 3. Dual-version parity: v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) clients succeed in parallel
  it('M6-03: Dual-version parity: v1 and v2 clients execute seamlessly side-by-side', async () => {
    const { spendToken } = await createTestMission();

    // v2 operation
    const v2Op = await createSignedV2Operation({
      toolId: 'tool:search',
      input: { query: 'Query v2 client' },
      spendToken,
    });

    // v1 operation
    const { verifyToken } = await import('@/lib/auth');
    const claims = await verifyToken(spendToken);
    const v1OpId = randomUUID();
    await createQuote({
      operationId: v1OpId,
      toolId: 'tool:search',
      input: { query: 'Query v1 client' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: v1OpId, tokenClaims: claims });
    const signedV1 = await signOperationAuthorization({
      operationId: v1OpId,
      agentPrivateKey: TEST_AGENT_KEY,
    });
    const v1Payload = {
      x402Version: 1,
      scheme: 'exact',
      network: LEGACY_AVALANCHE_FUJI,
      payload: {
        authorization: {
          from: signedV1.authFrom,
          to: signedV1.authTo,
          value: signedV1.authValue,
          validAfter: signedV1.validAfter?.toString(),
          validBefore: signedV1.validBefore?.toString(),
          nonce: signedV1.authNonce,
        },
        signature: signedV1.authSignature,
      },
    };
    const v1Header = Buffer.from(JSON.stringify(v1Payload)).toString('base64');

    // Send both requests concurrently
    const reqV2 = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': v2Op.operationId,
        [X402_V2_SIGNATURE_HEADER]: v2Op.paymentSignatureHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: v2Op.input }),
    });

    const reqV1 = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': v1OpId,
        [X402_V1_HEADER]: v1Header,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: { query: 'Query v1 client' } }),
    });

    const [resV2, resV1] = await Promise.all([
      toolRoutePOST(reqV2, { params: Promise.resolve({ id: 'tool:search' }) }),
      toolRoutePOST(reqV1, { params: Promise.resolve({ id: 'tool:search' }) }),
    ]);

    expect(resV2.status).toBe(200);
    expect(resV1.status).toBe(200);

    const jsonV2 = await resV2.json();
    const jsonV1 = await resV1.json();
    expect(jsonV2.state).toBe('SETTLED');
    expect(jsonV1.state).toBe('SETTLED');
  });

  // 4. ATC'26 F1a under v2: cross-resource reuse blocked with 403 PAYMENT_NOT_BOUND_TO_REQUEST
  it('M6-04: ATC 26 F1a cross-resource reuse under v2 is strictly blocked with 403', async () => {
    const { spendToken } = await createTestMission();
    const { operationId, paymentSignatureHeader } = await createSignedV2Operation({
      toolId: 'tool:search',
      input: { query: 'Original query' },
      spendToken,
    });

    // Attacker tries to send payment for tool:search to tool:summary
    const attackReq = new NextRequest('http://localhost:3000/api/tools/tool:summary', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        [X402_V2_SIGNATURE_HEADER]: paymentSignatureHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: { text: 'Some text to summarize' } }),
    });

    const res = await toolRoutePOST(attackReq, { params: Promise.resolve({ id: 'tool:summary' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('PAYMENT_NOT_BOUND_TO_REQUEST');
  });

  // 5. ATC'26 F1b under v2: parameter tampering blocked with 403 PAYMENT_NOT_BOUND_TO_REQUEST
  it('M6-05: ATC 26 F1b body tampering under v2 is strictly blocked with 403', async () => {
    const { spendToken } = await createTestMission();
    const { operationId, paymentSignatureHeader } = await createSignedV2Operation({
      toolId: 'tool:search',
      input: { query: 'Legitimate search query' },
      spendToken,
    });

    // Attacker alters the query argument
    const tamperedReq = new NextRequest('http://localhost:3000/api/tools/tool:search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${spendToken}`,
        'x-operation-id': operationId,
        [X402_V2_SIGNATURE_HEADER]: paymentSignatureHeader,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ arguments: { query: 'Tampered malicious query' } }),
    });

    const res = await toolRoutePOST(tamperedReq, { params: Promise.resolve({ id: 'tool:search' }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('PAYMENT_NOT_BOUND_TO_REQUEST');
  });

  // 6. M6-F1: Dynamic env flag X402_VERSION=1 yields v1 header and body format
  it('M6-F1: Dynamic env flag X402_VERSION=1 yields v1 header and body format', async () => {
    const origEnv = process.env.X402_VERSION;
    try {
      process.env.X402_VERSION = '1';
      const { spendToken } = await createTestMission();
      const operationId = randomUUID();

      const req = new NextRequest('http://localhost:3000/api/tools/tool:search', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${spendToken}`,
          'x-operation-id': operationId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ arguments: { query: 'Test v1 query' } }),
      });

      const res = await toolRoutePOST(req, { params: Promise.resolve({ id: 'tool:search' }) });
      expect(res.status).toBe(402);

      // Verify v1 header is present
      const v1Header = res.headers.get(X402_V1_HEADER);
      expect(v1Header).toBeDefined();
      expect(v1Header).not.toBeNull();

      const body = await res.json();
      expect(body.x402Version).toBe(1);
      expect(body.error).toBe('X-PAYMENT header is required');
      expect(body.accepts[0].network).toBe(LEGACY_AVALANCHE_FUJI);
      expect(body.accepts[0].maxAmountRequired).toBe('100000');
    } finally {
      if (origEnv !== undefined) {
        process.env.X402_VERSION = origEnv;
      } else {
        delete process.env.X402_VERSION;
      }
    }
  });

  // 7. M6-F1: Dynamic env flag X402_VERSION=2 yields v2 header and body format
  it('M6-F1: Dynamic env flag X402_VERSION=2 yields v2 header and body format', async () => {
    const origEnv = process.env.X402_VERSION;
    try {
      process.env.X402_VERSION = '2';
      const { spendToken } = await createTestMission();
      const operationId = randomUUID();

      const req = new NextRequest('http://localhost:3000/api/tools/tool:search', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${spendToken}`,
          'x-operation-id': operationId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ arguments: { query: 'Test v2 query' } }),
      });

      const res = await toolRoutePOST(req, { params: Promise.resolve({ id: 'tool:search' }) });
      expect(res.status).toBe(402);

      // Verify v2 header is present
      const v2Header = res.headers.get(X402_V2_REQUIRED_HEADER);
      expect(v2Header).toBeDefined();
      expect(v2Header).not.toBeNull();

      const body = await res.json();
      expect(body.x402Version).toBe(2);
      expect(body.error).toBe('PAYMENT-SIGNATURE header is required');
      expect(body.accepts[0].network).toBe(CAIP2_AVALANCHE_FUJI);
      expect(body.accepts[0].amount).toBe('100000');
    } finally {
      if (origEnv !== undefined) {
        process.env.X402_VERSION = origEnv;
      } else {
        delete process.env.X402_VERSION;
      }
    }
  });
});
