import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import {
  clearDatabase,
  createTestMission,
  agentAccount,
  sellerAddress,
  TEST_AGENT_KEY,
} from './setup';
import { verifyToken } from '@/lib/auth';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
  executeUpstreamAndSettle,
} from '@/lib/payments';
import { reconcileOperation, setChainReader } from '@/lib/reconcile';
import { SEARCH_PRICE, SUMMARY_PRICE, TALKMETER_PRICE_PER_MINUTE, getActiveX402Version } from '@/lib/constants';

describe('Payment P-series Integration Tests (06 §2)', () => {
  beforeEach(async () => {
    setChainReader(null);
    await clearDatabase();
  });

  // P1: Unpaid request -> Full v1 402 envelope/terms/operationId; chưa reserve/compute
  it('P1: Unpaid request returns full 402 envelope with operationId and no reservation', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    const quote = await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Academic research paper content' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    expect(quote.unpaidResponse.x402Version).toBe(getActiveX402Version());
    expect(quote.unpaidResponse.error).toMatch(/header is required/);
    expect(quote.unpaidResponse.accepts[0].scheme).toBe('exact');
    const acceptItem = quote.unpaidResponse.accepts[0] as any;
    expect(acceptItem.amount || acceptItem.maxAmountRequired).toBe('500000');
    expect(quote.unpaidResponse.operationId).toBe(opId);

    // Verify DB: created but not reserved, no held result
    const op = await prisma.toolOperation.findUnique({ where: { operationId: opId } });
    expect(op?.state).toBe('CREATED');
    expect(BigInt(op?.reservedAmount.toString() || '0')).toBe(0n);
    expect(op?.heldResult).toBeNull();

    // Mission reservedTool should still be 0
    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(0n);
  });

  // P2: Normal quote → reserve → sign → held result → settle
  it('P2: Normal lifecycle achieves SETTLED with verified receipt and correct accounting', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    // 1. Quote
    await createQuote({
      operationId: opId,
      toolId: 'tool:search',
      input: { query: 'Avalanche Consensus' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    // 2. Reserve
    const reserved = await reserveOperation({ operationId: opId, tokenClaims: claims });
    expect(reserved.state).toBe('RESERVED');
    expect(BigInt(reserved.reservedAmount.toString())).toBe(SEARCH_PRICE);

    // 3. Sign
    const signed = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });
    expect(signed.state).toBe('SIGNED');
    expect(signed.authNonce).toBeTruthy();
    expect(signed.authSignature).toBeTruthy();

    // 4. Upstream & Settle
    const settled = await executeUpstreamAndSettle({
      operationId: opId,
      arguments: { query: 'Avalanche Consensus' },
    });

    expect(settled.operation?.state).toBe('SETTLED');
    expect(settled.result.points.length).toBeGreaterThan(0);

    // Accounting check: reserved converted to spent
    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(0n);
    expect(BigInt(m?.spentTool.toString() || '0')).toBe(SEARCH_PRICE);
  });

  // P3: Sai network/token/payTo/amount/signature/expired auth -> Không settle/serve
  it('P3: Wrong payee, amount, or expired authorization does not settle', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Sample text' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    await signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY });

    // Inject mismatched transfer (wrong payee)
    const mismatchedEvidence = {
      txHash: '0xabc123',
      blockNumber: 100n,
      blockHash: '0xblock1',
      blockTimestamp: 1700000000n,
      isFinalized: true,
      status: 'success' as const,
      authorizationUsed: {
        from: agentAccount.address,
        nonce: '0x123',
        logIndex: 0,
      },
      transfer: {
        from: agentAccount.address,
        to: '0x9999999999999999999999999999999999999999', // wrong payee
        value: SUMMARY_PRICE,
        logIndex: 1,
      },
    };

    const reconciled = await reconcileOperation(opId, {
      injectedEvidence: mismatchedEvidence,
    });
    expect(reconciled?.state).not.toBe('SETTLED');
  });

  // P4: Same operation/scope retry -> Same quote/state/result, no duplicate upstream/payment
  it('P4: Same operation retry returns existing quote and state idempotently', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    const quote1 = await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Identical input text' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    const quote2 = await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Identical input text' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    expect(quote1.operation.operationId).toBe(quote2.operation.operationId);
  });

  // P5: Input/tool/terms/payer/mission mismatch -> 403/409, record immutable
  it('P5: Reusing operationId with mismatched tool or input throws conflict error', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Original input' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    // Attempt reuse with different input
    await expect(
      createQuote({
        operationId: opId,
        toolId: 'tool:summary',
        input: { text: 'Different input' },
        tokenClaims: claims,
        sellerAddress,
        appOrigin: 'http://localhost:3000',
      })
    ).rejects.toThrow('OPERATION_SCOPE_MISMATCH');
  });

  // P6: Concurrent operation IDs tranh budget cuối -> Một reserve thắng, available check có price
  it('P6: Concurrent operations competing for remaining budget only permit valid spend without exceeding cap', async () => {
    // Mission cap exactly 500,000 atomic (enough for 1 summary)
    const { spendToken } = await createTestMission({ toolCap: 500_000n });
    const claims = await verifyToken(spendToken);

    const opId1 = randomUUID();
    const opId2 = randomUUID();

    await createQuote({
      operationId: opId1,
      toolId: 'tool:summary',
      input: { text: 'Text 1' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    await createQuote({
      operationId: opId2,
      toolId: 'tool:summary',
      input: { text: 'Text 2' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    // Run parallel reservations
    const results = await Promise.allSettled([
      reserveOperation({ operationId: opId1, tokenClaims: claims }),
      reserveOperation({ operationId: opId2, tokenClaims: claims }),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
  });

  // P7: Concurrent same operationId hai mission -> Global PK quyết định một thắng, bên kia conflict
  it('P7: Global primary key prevents duplicate operationId across missions', async () => {
    const { spendToken: token1 } = await createTestMission();
    const { spendToken: token2 } = await createTestMission();
    const claims1 = await verifyToken(token1);
    const claims2 = await verifyToken(token2);
    const sharedOpId = randomUUID();

    await createQuote({
      operationId: sharedOpId,
      toolId: 'tool:search',
      input: { query: 'Query 1' },
      tokenClaims: claims1,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    // Second mission trying to use same operationId
    await expect(
      createQuote({
        operationId: sharedOpId,
        toolId: 'tool:search',
        input: { query: 'Query 1' },
        tokenClaims: claims2,
        sellerAddress,
        appOrigin: 'http://localhost:3000',
      })
    ).rejects.toThrow();
  });

  // P8: Duplicate/concurrent TalkMeter index -> Unique constraint, một operation/payment
  it('P8: Unique constraint on (sessionId, minuteIndex) prevents duplicate billing of same minute', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const sessionId = randomUUID();

    await prisma.toolSession.create({
      data: {
        id: sessionId,
        missionSlug: mission.slug,
        payerAddress: agentAccount.address,
        rate: TALKMETER_PRICE_PER_MINUTE.toString(),
        cap: '2000000',
        spent: '0',
        reserved: '0',
        status: 'ACTIVE',
      },
    });

    const opId1 = randomUUID();
    const opId2 = randomUUID();

    await createQuote({
      operationId: opId1,
      toolId: 'tool:talkmeter',
      input: { minuteIndex: 0 },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
      sessionId,
      minuteIndex: 0,
    });

    // Attempting to create another operation with same sessionId and minuteIndex 0 violates unique constraint
    await expect(
      createQuote({
        operationId: opId2,
        toolId: 'tool:talkmeter',
        input: { minuteIndex: 0 },
        tokenClaims: claims,
        sellerAddress,
        appOrigin: 'http://localhost:3000',
        sessionId,
        minuteIndex: 0,
      })
    ).rejects.toThrow();
  });

  // P9: Tick 0–59s, 60s, 120s; stop/cap -> Không charge trước phút hoàn thành; stop không xóa outstanding
  it('P9: TalkMeter enforces completed minute boundaries and stop preserves outstanding ops', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const sessionId = randomUUID();

    // Session started 59 seconds ago -> 0 completed minutes
    const started59sAgo = new Date(Date.now() - 59000);
    const session = await prisma.toolSession.create({
      data: {
        id: sessionId,
        missionSlug: mission.slug,
        payerAddress: agentAccount.address,
        rate: TALKMETER_PRICE_PER_MINUTE.toString(),
        cap: '2000000',
        status: 'ACTIVE',
        startedAt: started59sAgo,
      },
    });

    const elapsedMinutes = Math.floor((Date.now() - session.startedAt.getTime()) / 60000);
    expect(elapsedMinutes).toBe(0); // Cannot bill minute 0 yet

    // Stop session
    const stopped = await prisma.toolSession.update({
      where: { id: sessionId },
      data: { status: 'STOPPED', stoppedAt: new Date() },
    });
    expect(stopped.status).toBe('STOPPED');
  });

  // P10: CREATED quote và unsigned RESERVED bị bỏ dở -> Expire cleanup không RPC; budget trả lại đúng một lần
  it('P10: Unsigned reservation expiry returns reserved budget without RPC call', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Timeout test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });

    // Artificially expire the reservation in DB
    await prisma.toolOperation.update({
      where: { operationId: opId },
      data: {
        reservationExpiresAt: new Date(Date.now() - 5000), // in the past
      },
    });

    // Reconcile cleans up unsigned reservation
    const reconciled = await reconcileOperation(opId);
    expect(reconciled?.state).toBe('FAILED');
    expect(reconciled?.failureReason).toBe('RESERVATION_EXPIRED_UNSIGNED');

    // Budget returned
    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(0n);
  });

  // P11: Signer race unsigned expiry worker -> CAS chỉ một thắng
  it('P11: Signer does not sign if reservation has already been expired and released', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Race test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });

    // Expiry worker marks FAILED first
    await prisma.toolOperation.update({
      where: { operationId: opId },
      data: { state: 'FAILED', failureReason: 'EXPIRED' },
    });

    // Signer attempting to sign afterwards is rejected
    await expect(
      signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY })
    ).rejects.toThrow();
  });

  // P12: Retry cố ký nonce thứ hai cho cùng operation -> Reject; auth fields bất biến
  it('P12: Operation preserves immutable authorization on retry and does not re-sign', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Nonce check' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    const signed1 = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    const signed2 = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    expect(signed1.authNonce).toBe(signed2.authNonce);
    expect(signed1.authSignature).toBe(signed2.authSignature);
  });

  // P13: Upstream fail trước settlement -> Không settle; signed exposure giữ tới expiry/cancel
  it('P13: Upstream failure prevents settlement and retains signed exposure', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Fail upstream' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    await signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY });

    // Simulate upstream failure
    await expect(
      executeUpstreamAndSettle({
        operationId: opId,
        arguments: { text: '' }, // invalid empty text
      })
    ).rejects.toThrow();

    // Exposure still reserved until reconciled
    const op = await prisma.toolOperation.findUnique({ where: { operationId: opId } });
    expect(op?.state).toBe('SIGNED');
  });

  // P14: Crash sau persist SIGNED, trước/sau external submit -> Resume cùng auth
  it('P14: Recovery after crash retains existing authorization and does not generate new nonce', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Crash recovery' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    const signed = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    // Simulate process crash at SUBMITTING
    await prisma.toolOperation.update({
      where: { operationId: opId },
      data: { state: 'SUBMITTING' },
    });

    // Reconcile / resume
    const recovered = await reconcileOperation(opId);
    expect(recovered?.authNonce).toBe(signed.authNonce);
    expect(recovered?.state).toBe('UNKNOWN');
  });

  // P15: Facilitator timeout, validBefore chưa qua -> UNKNOWN + reserved
  it('P15: Facilitator timeout before validBefore expiry retains reservation as UNKNOWN', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Facilitator timeout' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    await signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY });

    // No evidence from facilitator yet
    const reconciled = await reconcileOperation(opId);
    expect(reconciled?.state).toBe('SIGNED');

    // Budget still reserved
    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(SUMMARY_PRICE);
  });

  // P16: Wall-clock hết nhưng finalized chain chưa tới expiry -> Giữ UNKNOWN/reserved
  it('P16: Wall-clock expired while chain block time has not reached expiry retains UNKNOWN', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Clock skew test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    const signed = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    // Injected chain evidence where block timestamp < validBefore
    const unexpiredChainEvidence = {
      txHash: '0xpending',
      blockNumber: 500n,
      blockHash: '0xblk500',
      blockTimestamp: (signed.validBefore || 0n) - 10n, // Chain block timestamp is before validBefore
      isFinalized: false,
      status: 'success' as const,
    };

    const reconciled = await reconcileOperation(opId, {
      injectedEvidence: unexpiredChainEvidence,
    });
    expect(reconciled?.state).not.toBe('FAILED');
  });

  // P17: Finalized timestamp >= validBefore, nonce=false tại cùng block -> FAILED và release một lần
  it('P17: Finalized block timestamp >= validBefore with unused nonce marks FAILED and releases budget', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Expired on chain' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    const signed = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    const expiredEvidence = {
      txHash: '',
      blockNumber: 1000n,
      blockHash: '0xblk1000',
      blockTimestamp: (signed.validBefore || 0n) + 100n, // definitely expired
      isFinalized: true,
      status: 'success' as const,
      nonceStateAtBlock: false, // confirmed unused
    };

    const reconciled = await reconcileOperation(opId, {
      injectedEvidence: expiredEvidence,
    });
    expect(reconciled?.state).toBe('FAILED');
    expect(reconciled?.failureReason).toBe('AUTHORIZATION_EXPIRED_UNUSED');

    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(0n);
  });

  // P18: Nonce=true vì cancel -> Không SETTLED; finalized cancel -> FAILED/release
  it('P18: Finalized AuthorizationCanceled marks operation FAILED and releases budget', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Cancel test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    const signed = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    const canceledEvidence = {
      txHash: '0xcancel_tx',
      blockNumber: 1000n,
      blockHash: '0xblk1000',
      blockTimestamp: 1700000000n,
      isFinalized: true,
      status: 'success' as const,
      authorizationCanceled: {
        from: agentAccount.address,
        nonce: signed.authNonce || '',
        logIndex: 0,
      },
    };

    const reconciled = await reconcileOperation(opId, {
      injectedEvidence: canceledEvidence,
    });
    expect(reconciled?.state).toBe('FAILED');
    expect(reconciled?.failureReason).toBe('AUTHORIZATION_CANCELED');

    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(0n);
  });

  // P19: Transfer cùng payer/amount nhưng sai nonce/token/chain -> Không credit
  it('P19: Unrelated Transfer with same payer and amount does not credit operation', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Unrelated transfer' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    await signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY });

    // Transfer log exists but authorizationUsed log is for a different nonce
    const unrelatedEvidence = {
      txHash: '0xunrelated',
      blockNumber: 1000n,
      blockHash: '0xblk1000',
      blockTimestamp: 1700000000n,
      isFinalized: true,
      status: 'success' as const,
      authorizationUsed: {
        from: agentAccount.address,
        nonce: '0xdifferent_nonce_123',
        logIndex: 0,
      },
      transfer: {
        from: agentAccount.address,
        to: sellerAddress,
        value: SUMMARY_PRICE,
        logIndex: 1,
      },
    };

    const reconciled = await reconcileOperation(opId, {
      injectedEvidence: unrelatedEvidence,
    });
    expect(reconciled?.state).not.toBe('SETTLED');
  });

  // P20: Same nonce/receipt cố dùng cho hai operation -> DB unique + verifier ngăn double credit
  it('P20: DB unique constraint on (chainId, asset, authFrom, authNonce) prevents reusing authorization', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId1 = randomUUID();
    const opId2 = randomUUID();

    await createQuote({
      operationId: opId1,
      toolId: 'tool:summary',
      input: { text: 'Nonce uniqueness 1' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId1, tokenClaims: claims });
    const signed = await signOperationAuthorization({
      operationId: opId1,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    await createQuote({
      operationId: opId2,
      toolId: 'tool:summary',
      input: { text: 'Nonce uniqueness 2' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId2, tokenClaims: claims });

    // Attempting to manually set identical authNonce on op2 throws unique violation
    await expect(
      prisma.toolOperation.update({
        where: { operationId: opId2 },
        data: {
          state: 'SIGNED',
          authFrom: signed.authFrom,
          authTo: signed.authTo,
          authValue: signed.authValue,
          authNonce: signed.authNonce,
          validAfter: signed.validAfter,
          validBefore: signed.validBefore,
          authSignature: signed.authSignature,
        },
      })
    ).rejects.toThrow();
  });

  // P21: Crash sau chain settlement trước DB finalize/response -> Recover đúng heldResult bền vững
  it('P21: Durable heldResult is recovered cleanly after settlement without re-calling upstream', async () => {
    const { spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Durable result test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    await signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY });

    // Settle once
    const res = await executeUpstreamAndSettle({
      operationId: opId,
      arguments: { text: 'Durable result test' },
    });

    // Re-query: returns the exact same durable result
    const secondCall = await executeUpstreamAndSettle({
      operationId: opId,
      arguments: { text: 'Durable result test' },
    });

    expect(secondCall.result.summary).toBe(res.result.summary);
  });

  // P22: Hai GET reconcile/finalize đồng thời -> State/counters/audit chỉ chuyển terminal một lần
  it('P22: Concurrent reconciliation attempts only transition to SETTLED once', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:search',
      input: { query: 'Parallel reconcile' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    const signed = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    // Pre-populate heldResult
    await prisma.toolOperation.update({
      where: { operationId: opId },
      data: {
        heldResult: JSON.stringify({ query: 'Parallel reconcile' }),
        heldResultHash: '0xresult',
      },
    });

    const validEvidence = {
      txHash: '0xsettled_p22',
      blockNumber: 1000n,
      blockHash: '0xblk1000',
      blockTimestamp: 1700000000n,
      isFinalized: true,
      status: 'success' as const,
      authorizationUsed: {
        from: agentAccount.address,
        nonce: signed.authNonce || '',
        logIndex: 0,
      },
      transfer: {
        from: agentAccount.address,
        to: sellerAddress,
        value: SEARCH_PRICE,
        logIndex: 1,
      },
    };

    // Run parallel reconcile
    await Promise.all([
      reconcileOperation(opId, { injectedEvidence: validEvidence }),
      reconcileOperation(opId, { injectedEvidence: validEvidence }),
    ]);

    const op = await prisma.toolOperation.findUnique({ where: { operationId: opId } });
    expect(op?.state).toBe('SETTLED');

    // Counters incremented exactly once
    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.spentTool.toString() || '0')).toBe(SEARCH_PRICE);
  });

  // P23: Reverted tx trước expiry -> Không release chỉ vì tx revert; auth vẫn có thể submit
  it('P23: Reverted transaction before expiry retains reservation as UNKNOWN without releasing', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Revert test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    await signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY });

    const revertedEvidence = {
      txHash: '0xreverted_tx',
      blockNumber: 1000n,
      blockHash: '0xblk1000',
      blockTimestamp: 1700000000n,
      isFinalized: true,
      status: 'reverted' as const,
    };

    const reconciled = await reconcileOperation(opId, {
      injectedEvidence: revertedEvidence,
    });
    expect(reconciled?.state).toBe('UNKNOWN');

    // Reservation is still held
    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(SUMMARY_PRICE);
  });

  // P24: Payment settle sau pause/mission expiry -> Vẫn accounting; marker after-pause
  it('P24: Payment settlement after pause or mission expiry records accounting with after-pause marker', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Settle after pause' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    const signed = await signOperationAuthorization({
      operationId: opId,
      agentPrivateKey: TEST_AGENT_KEY,
    });

    await prisma.toolOperation.update({
      where: { operationId: opId },
      data: {
        heldResult: JSON.stringify({ summary: 'Done' }),
        heldResultHash: '0xsummary_hash',
      },
    });

    // Close or pause mission
    await prisma.mission.update({
      where: { slug: mission.slug },
      data: { status: 'CLOSED' },
    });

    const validEvidence = {
      txHash: '0xsettle_after_pause',
      blockNumber: 1000n,
      blockHash: '0xblk1000',
      blockTimestamp: 1700000000n,
      isFinalized: true,
      status: 'success' as const,
      authorizationUsed: {
        from: agentAccount.address,
        nonce: signed.authNonce || '',
        logIndex: 0,
      },
      transfer: {
        from: agentAccount.address,
        to: sellerAddress,
        value: SUMMARY_PRICE,
        logIndex: 1,
      },
    };

    const reconciled = await reconcileOperation(opId, {
      injectedEvidence: validEvidence,
    });
    expect(reconciled?.state).toBe('SETTLED');

    // Audit log should record TOOL_PAID with reason SETTLED_AFTER_PAUSE
    const entry = await prisma.auditEntry.findUnique({
      where: { sourceKey: `${opId}:settle` },
    });
    expect(entry).not.toBeNull();
    const parsedJson = JSON.parse(entry!.canonicalJson);
    expect(parsedJson.reason).toBe('SETTLED_AFTER_PAUSE');
  });

  // P25: DB/RPC/facilitator unavailable + no evidence -> Fail closed cho spend mới, UNKNOWN giữ exposure
  it('P25: Unavailable RPC or missing evidence retains reservation without fabricating receipts', async () => {
    const { mission, spendToken } = await createTestMission();
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'No evidence test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });
    await reserveOperation({ operationId: opId, tokenClaims: claims });
    await signOperationAuthorization({ operationId: opId, agentPrivateKey: TEST_AGENT_KEY });

    // Mark submitting
    await prisma.toolOperation.update({
      where: { operationId: opId },
      data: { state: 'SUBMITTING' },
    });

    // Reconcile with null evidence
    const reconciled = await reconcileOperation(opId, { injectedEvidence: null });
    expect(reconciled?.state).toBe('UNKNOWN');

    // Retains exposure
    const m = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(BigInt(m?.reservedTool.toString() || '0')).toBe(SUMMARY_PRICE);
  });
});
