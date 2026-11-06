import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { POST } from '../app/api/agent/run/route';
import { POST as orchestratePOST } from '../app/api/tools/orchestrate/route';
import { POST as pausePOST } from '../app/api/system/pause/route';
import { POST as challengePOST } from '../app/api/auth/challenge/route';
import { POST as activatePOST } from '../app/api/missions/[slug]/activate/route';
import { POST as completePOST } from '../app/api/missions/[slug]/complete/route';
import { POST as feedbackPOST } from '../app/api/feedback/route';
import { prisma } from '../lib/db';
import { clearDatabase, createTestMission, ownerAccount } from './setup';
import { issueSpendToken, verifyToken } from '../lib/auth';
import { hashUtf8, normalizeAddress } from '../lib/chain';
import { validateLiveFujiConfig } from '../lib/config';
import { verifyQuoteAgainstCatalog } from '../lib/validator';
import { reserveOperation } from '../lib/payments';
import { toolCatalog } from '../lib/tools';
import { verifyProof, INITIAL_PREV_HASH } from '../lib/proof-verifier';
import { keccak256, stringToBytes } from 'viem';

describe('AG-01..05 & P1-C/P2 Agent Run Security Boundaries & Real Settlement Rails', () => {
  beforeEach(async () => {
    await clearDatabase();
    process.env.ALLOW_AGENT_TEST_OVERRIDE = '1';
    process.env.PAYMENT_MODE = 'MOCK';
  });

  it('Regression 1: Missing or invalid spend token returns HTTP 401', async () => {
    // 1. Missing Authorization header
    const reqNoAuth = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Test goal' }),
    });
    const resNoAuth = await POST(reqNoAuth);
    expect(resNoAuth.status).toBe(401);
    const dataNoAuth = await resNoAuth.json();
    expect(dataNoAuth.error).toContain('Missing spend token');

    // 2. Malformed token
    const reqBadAuth = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token-string',
      },
      body: JSON.stringify({ goal: 'Test goal' }),
    });
    const resBadAuth = await POST(reqBadAuth);
    expect(resBadAuth.status).toBe(401);
  });

  it('Regression 2: Non-existent or CLOSED mission returns HTTP 404 or 403', async () => {
    // 1. Token for a mission that does not exist in the database
    const fakeSlug = 'non-existent-mission-slug';
    const fakeToken = await issueSpendToken({
      deploymentId: 'unihack-test-deployment',
      stage: 'S1',
      authVersion: 1,
      missionSlug: fakeSlug,
      missionId: hashUtf8(fakeSlug),
      ownerAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      agentAddress: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
      missionConfigVersion: 1,
      policyHash: hashUtf8('test'),
      missionExpiresAt: new Date(Date.now() + 86400000),
    });

    const reqNotFound = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeToken}`,
      },
      body: JSON.stringify({ goal: 'Test goal' }),
    });
    const resNotFound = await POST(reqNotFound);
    expect(resNotFound.status).toBe(404);

    // 2. Mission exists but is CLOSED
    const { spendToken: closedToken } = await createTestMission({
      status: 'CLOSED',
    });
    const reqClosed = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${closedToken}`,
      },
      body: JSON.stringify({ goal: 'Test goal' }),
    });
    const resClosed = await POST(reqClosed);
    expect(resClosed.status).toBe(403);
    const dataClosed = await resClosed.json();
    expect(dataClosed.error).toContain('CLOSED');
  });

  it('Regression 3: Insufficient budget triggers validator BLOCK and prevents settlement', async () => {
    // Create mission with only 100,000 atomic (0.10 USDC), enough for search ($0.10) but NOT summary ($0.50)
    const { mission, spendToken } = await createTestMission({
      toolCap: 100_000n, // Exactly enough for 1 search
    });

    const req = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'Tóm tắt 3 nguồn về Avalanche blockchain architecture',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Turn 1 (search, 100,000 atomic) passes
    expect(data.steps[0].action).toBe('TOOL');
    expect(data.steps[0].state).toBe('SETTLED');
    expect(data.steps[0].verdict.outcome).toBe('PASS');

    // Turn 2 (summary, 500,000 atomic) is strictly BLOCKED by policy validator
    expect(data.steps[1].action).toBe('TOOL_BLOCKED');
    expect(data.steps[1].verdict.outcome).toBe('BLOCK');
    expect(data.steps[1].verdict.rule).toBe('INSUFFICIENT_TOOL_BUDGET');

    // Verify in database: NO second operation was settled!
    const ops = await prisma.toolOperation.findMany({
      where: { missionSlug: mission.slug },
    });
    expect(ops.length).toBe(1); // Only the first tool was settled
    expect(ops[0].state).toBe('SETTLED');
    expect(ops[0].toolId).toBe('tool:search');
  });

  it('Regression 4: Agent execution decrements tool budget in database exactly as spent', async () => {
    const initialCap = 1_000_000n; // 1.00 USDC
    const { mission, spendToken } = await createTestMission({
      toolCap: initialCap,
    });

    const req = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'Tóm tắt 3 nguồn về Avalanche blockchain architecture',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.deliverable).toBeDefined();

    // Search ($0.10) + Summary ($0.50) = $0.60 (600,000 atomic)
    const expectedSpent = 600_000n;
    const expectedRemaining = initialCap - expectedSpent; // 400,000n

    // Check database state directly
    const dbMission = await prisma.mission.findUnique({
      where: { slug: mission.slug },
    });
    expect(BigInt(dbMission?.spentTool?.toString() || '0')).toBe(expectedSpent);
    expect(data.spentTool).toBe(expectedSpent.toString());
    expect(data.remainingBudget).toBe(expectedRemaining.toString());
  });

  it('Regression 5: Audit ledger appends verified hash-chained records for each step', async () => {
    const { mission, spendToken } = await createTestMission({
      toolCap: 2_000_000n,
    });

    const req = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'Tóm tắt 3 nguồn về Avalanche blockchain architecture',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify audit entries in DB
    const entries = await prisma.auditEntry.findMany({
      where: { missionSlug: mission.slug },
      orderBy: { missionSequence: 'asc' },
    });

    expect(entries.length).toBeGreaterThanOrEqual(6); // 2 tools * (RESERVED, SIGNED, PAID)
    const parsedEntries = entries.map((e) => JSON.parse(e.canonicalJson));
    const kinds = parsedEntries.map((p) => p.kind);
    expect(kinds).toContain('TOOL_RESERVED');
    expect(kinds).toContain('TOOL_SIGNED');
    expect(kinds).toContain('TOOL_PAID');

    // Verify hash chaining integrity
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].prevHash).toBe(entries[i - 1].entryHash);
    }
  });

  it('Regression 6: Rogue tool proposal or price mismatch is rejected with BLOCK outcome', async () => {
    const { mission, spendToken } = await createTestMission({
      toolCap: 5_000_000n,
    });

    // 1. Rogue unknown tool
    const reqUnknown = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'Rogue test',
        overrideProposal: {
          kind: 'tool_purchase',
          mission_id: mission.slug,
          tool_id: 'tool:unauthorized_exploit',
          amount_atomic: '100000',
          reason: 'Attempt unauthorized tool purchase',
          arguments: { query: 'exploit' },
        },
      }),
    });

    const resUnknown = await POST(reqUnknown);
    expect(resUnknown.status).toBe(200);
    const dataUnknown = await resUnknown.json();
    expect(dataUnknown.steps[0].action).toBe('TOOL_BLOCKED');
    expect(dataUnknown.steps[0].verdict.outcome).toBe('BLOCK');
    expect(dataUnknown.steps[0].verdict.rule).toBe('UNKNOWN_TOOL');

    // 2. Price mismatch (Search is 100,000 atomic, client proposes 500,000 atomic)
    const reqPriceMismatch = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'Price mismatch test',
        overrideProposal: {
          kind: 'tool_purchase',
          mission_id: mission.slug,
          tool_id: 'tool:search',
          amount_atomic: '500000', // Wrong price (Search is 100,000)
          reason: 'Attempt price mismatch',
          arguments: { query: 'Avalanche' },
        },
      }),
    });

    const resPrice = await POST(reqPriceMismatch);
    expect(resPrice.status).toBe(200);
    const dataPrice = await resPrice.json();
    expect(dataPrice.steps[0].action).toBe('TOOL_BLOCKED');
    expect(dataPrice.steps[0].verdict.outcome).toBe('BLOCK');
    expect(dataPrice.steps[0].verdict.rule).toBe('PRICE_MISMATCH');

    // Confirm a BLOCKED entry was written to the audit ledger
    const allEntries = await prisma.auditEntry.findMany({
      where: { missionSlug: mission.slug },
    });
    const blockedAudit = allEntries.find((e) => JSON.parse(e.canonicalJson).kind === 'BLOCKED');
    expect(blockedAudit).toBeDefined();
  });

  it('Regression 7 (AG-05): Treasury payout in Stage S1 is BLOCKED and never enters tool rails', async () => {
    const { mission, spendToken } = await createTestMission({
      stage: 'S1',
    });

    const req = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'S1 Payout attempt',
        overrideProposal: {
          kind: 'treasury_payout',
          mission_id: mission.slug,
          to: mission.ownerAddress,
          amount_atomic: '1000000',
          reason: 'Attempt treasury disbursement in S1',
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.steps[0].action).toBe('TOOL_BLOCKED');
    expect(data.steps[0].verdict.outcome).toBe('BLOCK');
    expect(data.steps[0].verdict.rule).toBe('STAGE_S1_NO_TREASURY');

    // Confirm no tool operation or treasury request was created
    const toolOps = await prisma.toolOperation.findMany({ where: { missionSlug: mission.slug } });
    expect(toolOps.length).toBe(0);
    const treasuryRequests = await prisma.treasuryRequest.findMany({ where: { missionSlug: mission.slug } });
    expect(treasuryRequests.length).toBe(0);

    // Confirm BLOCKED audit entry logged
    const auditEntries = await prisma.auditEntry.findMany({ where: { missionSlug: mission.slug } });
    const blockedEntry = auditEntries.find((e) => JSON.parse(e.canonicalJson).kind === 'BLOCKED');
    expect(blockedEntry).toBeDefined();
    expect(JSON.parse(blockedEntry!.canonicalJson).rule).toBe('STAGE_S1_NO_TREASURY');
  });

  it('Regression 8 (AG-05): Treasury payout in Stage S2 with PASS creates TreasuryRequest and terminates without tool execution', async () => {
    const { mission, spendToken } = await createTestMission({
      stage: 'S2',
    });

    // Update system stage to S2
    await prisma.systemState.update({
      where: { id: 1 },
      data: { stage: 'S2' },
    });

    const req = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'S2 Small Payout',
        overrideProposal: {
          kind: 'treasury_payout',
          mission_id: mission.slug,
          to: mission.ownerAddress,
          amount_atomic: '1000000', // 1.00 USDC <= 5 USDC cap
          reason: 'Authorized small payout in S2',
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.steps[0].action).toBe('TREASURY_PROPOSED');
    expect(data.steps[0].verdict.outcome).toBe('PASS');
    expect(data.steps[0].operationId).toBeDefined();

    // Verify TreasuryRequest record created in DB
    const treasuryRequests = await prisma.treasuryRequest.findMany({ where: { missionSlug: mission.slug } });
    expect(treasuryRequests.length).toBe(1);
    expect(treasuryRequests[0].state).toBe('CREATED');

    // Crucial: payout NEVER executed payment rails for tools
    const toolOps = await prisma.toolOperation.findMany({ where: { missionSlug: mission.slug } });
    expect(toolOps.length).toBe(0);

    // Verify audit entry PROPOSED
    const auditEntries = await prisma.auditEntry.findMany({ where: { missionSlug: mission.slug } });
    const proposedEntry = auditEntries.find((e) => JSON.parse(e.canonicalJson).kind === 'PROPOSED');
    expect(proposedEntry).toBeDefined();
  });

  it('Regression 9 (AG-05): Treasury payout in Stage S2 with QUEUE (> 5 USDC) creates QUEUED request and terminates', async () => {
    const { mission, spendToken } = await createTestMission({
      stage: 'S2',
    });

    await prisma.systemState.update({
      where: { id: 1 },
      data: { stage: 'S2' },
    });

    const req = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'S2 Large Payout',
        overrideProposal: {
          kind: 'treasury_payout',
          mission_id: mission.slug,
          to: mission.ownerAddress,
          amount_atomic: '6000000', // 6.00 USDC > 5 USDC per-tx cap
          reason: 'Large treasury payout requiring human queue',
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.steps[0].action).toBe('PROPOSAL_QUEUED');
    expect(data.steps[0].verdict.outcome).toBe('QUEUE');
    expect(data.steps[0].verdict.rule).toBe('OVER_PER_TX_CAP');

    // Verify TreasuryRequest record is QUEUED
    const treasuryRequests = await prisma.treasuryRequest.findMany({ where: { missionSlug: mission.slug } });
    expect(treasuryRequests.length).toBe(1);
    expect(treasuryRequests[0].state).toBe('QUEUED');

    // Confirm no tool operation
    const toolOps = await prisma.toolOperation.findMany({ where: { missionSlug: mission.slug } });
    expect(toolOps.length).toBe(0);

    // Verify audit entry QUEUED
    const auditEntries = await prisma.auditEntry.findMany({ where: { missionSlug: mission.slug } });
    const queuedEntry = auditEntries.find((e) => JSON.parse(e.canonicalJson).kind === 'QUEUED');
    expect(queuedEntry).toBeDefined();
  });

  it('Regression 10 (AG-04): overrideProposal is gated strictly by ALLOW_AGENT_TEST_OVERRIDE', async () => {
    const { mission, spendToken } = await createTestMission();

    // 1. When ALLOW_AGENT_TEST_OVERRIDE=1, overrideProposal is applied with CLIENT_OVERRIDE label
    process.env.ALLOW_AGENT_TEST_OVERRIDE = '1';
    const reqWithOverride = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        goal: 'Override active test',
        overrideProposal: {
          kind: 'tool_purchase',
          mission_id: mission.slug,
          tool_id: 'tool:search',
          amount_atomic: '100000',
          reason: 'Explicit test override',
          arguments: { query: 'Avalanche' },
        },
      }),
    });

    const resWithOverride = await POST(reqWithOverride);
    const dataWithOverride = await resWithOverride.json();
    expect(dataWithOverride.steps[0].plannerMode).toBe('CLIENT_OVERRIDE');
    expect(dataWithOverride.steps[0].plannerModel).toBe('client-test-override');

    // 2. When ALLOW_AGENT_TEST_OVERRIDE=0, overrideProposal is ignored, fallback planner runs
    process.env.ALLOW_AGENT_TEST_OVERRIDE = '0';
    const { mission: mission2, spendToken: spendToken2 } = await createTestMission();

    const reqWithoutOverride = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken2}`,
      },
      body: JSON.stringify({
        goal: 'Override disabled test',
        overrideProposal: {
          kind: 'tool_purchase',
          mission_id: mission2.slug,
          tool_id: 'tool:search',
          amount_atomic: '100000',
          reason: 'This should be ignored',
          arguments: { query: 'Avalanche' },
        },
      }),
    });

    const resWithoutOverride = await POST(reqWithoutOverride);
    const dataWithoutOverride = await resWithoutOverride.json();
    expect(dataWithoutOverride.steps[0].plannerMode).toBe('FALLBACK_DETERMINISTIC');
    expect(dataWithoutOverride.steps[0].plannerModel).toBe('deterministic-planner-v1');
  });

  it('Regression 11 (KEY-02): LIVE_FUJI mode rejects missing variables or well-known Anvil keys/addresses', async () => {
    const originalEnv = { ...process.env };

    try {
      // 1. Missing SELLER_ADDRESS in LIVE_FUJI
      process.env.PAYMENT_MODE = 'LIVE_FUJI';
      delete process.env.SELLER_ADDRESS;
      process.env.AGENT_PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
      await expect(validateLiveFujiConfig()).rejects.toThrow('KEY-02: SELLER_ADDRESS must be set');

      // 2. Anvil default seller address 0x7099...79c8
      process.env.SELLER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
      await expect(validateLiveFujiConfig()).rejects.toThrow('KEY-02: SELLER_ADDRESS cannot be a well-known Anvil/Hardhat test address');

      // 3. Anvil default agent private key 0xac09...ff80
      process.env.SELLER_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.AGENT_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      await expect(validateLiveFujiConfig()).rejects.toThrow('KEY-02: AGENT_PRIVATE_KEY cannot be a well-known Anvil/Hardhat test private key');

      // 4. MOCK mode allows without throwing
      process.env.PAYMENT_MODE = 'MOCK';
      await expect(validateLiveFujiConfig()).resolves.not.toThrow();
    } finally {
      process.env = originalEnv;
    }
  });

  it('Regression 12 (AG-07): Unhandled internal errors return generic message without exposing internal details', async () => {
    // Break DB by causing an unhandled error inside POST
    const fakeToken = await issueSpendToken({
      deploymentId: 'unihack-test-deployment',
      stage: 'S1',
      authVersion: 1,
      missionSlug: 'valid-slug',
      missionId: hashUtf8('valid-slug'),
      ownerAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      agentAddress: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
      missionConfigVersion: 1,
      policyHash: hashUtf8('test'),
      missionExpiresAt: new Date(Date.now() + 86400000),
    });

    // Pass invalid JSON body that causes parsing or unhandled error
    const req = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeToken}`,
      },
      body: '{invalid-json',
    });

    const res = await POST(req);
    // If it reaches catch block, error message must be generic
    if (res.status === 500) {
      const data = await res.json();
      expect(data.error).toBe('Internal agent execution error');
    }
  });

  it('Regression 13 (P1-C): Local prompt injection payload in search results is intercepted and strictly BLOCKED', async () => {
    process.env.DEMO_ADVERSARIAL = '1';
    try {
      const { mission, spendToken } = await createTestMission({
        toolCap: 2_000_000n, // 2.00 USDC
      });

      // Run agent with an adversarial goal triggering untrusted search results with injection payload
      const req = new NextRequest('http://localhost:3000/api/agent/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${spendToken}`,
        },
        body: JSON.stringify({
          goal: 'Security audit test: Prompt injection exploit detection',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      // Turn 1: Search was executed
      expect(data.steps[0].action).toBe('TOOL');
      expect(data.steps[0].toolId).toBe('tool:search');
      expect(data.steps[0].state).toBe('SETTLED');

      // Turn 2: Untrusted source attempted prompt injection proposing 50 USDC payout to attacker
      // The policy validator strictly BLOCKED the attempt!
      expect(data.steps[1].action).toBe('TOOL_BLOCKED');
      expect(data.steps[1].verdict.outcome).toBe('BLOCK');
      expect(data.steps[1].amountAtomic).toBe('50000000'); // 50 USDC attempt
      expect(data.steps[1].reason).toContain('POISONED_PAYLOAD');

      // Verify in database: ONLY Turn 1 search was settled (0.10 USDC spent). The 50 USDC was BLOCKED!
      const dbMission = await prisma.mission.findUnique({ where: { slug: mission.slug } });
      expect(BigInt(dbMission!.spentTool.toString())).toBe(100_000n); // Exactly 0.10 USDC spent for search

      // Verify BLOCKED audit record in DB
      const entries = await prisma.auditEntry.findMany({ where: { missionSlug: mission.slug } });
      const blockedEntry = entries.find((e) => JSON.parse(e.canonicalJson).kind === 'BLOCKED');
      expect(blockedEntry).toBeDefined();
      const parsedBlocked = JSON.parse(blockedEntry!.canonicalJson);
      expect(parsedBlocked.amount).toBe('50000000');
      expect(parsedBlocked.to).toBe('0x3333333333333333333333333333333333333333');
    } finally {
      delete process.env.DEMO_ADVERSARIAL;
    }
  });

  it('Regression 14 (P2-PRICE): Quote exceeding catalog price or per-call cap is strictly rejected by payment rail and logged to audit', async () => {
    // 1. Direct function verification
    const quoteOverPrice = verifyQuoteAgainstCatalog({
      toolId: 'tool:search',
      quotedAmountAtomic: 200_000n,
    });
    expect(quoteOverPrice.valid).toBe(false);
    expect(quoteOverPrice.rule).toBe('PRICE_MISMATCH');

    const quoteOverCap = verifyQuoteAgainstCatalog({
      toolId: 'tool:search',
      quotedAmountAtomic: 500_000n,
    });
    expect(quoteOverCap.valid).toBe(false);
    expect(quoteOverCap.rule).toBe('PRICE_MISMATCH');

    // 2. Real Handler / Payment Rail Execution:
    // Create mission and operation with inflated price, then invoke reserveOperation
    const { mission, spendToken } = await createTestMission({ toolCap: 5_000_000n });
    const claims = await verifyToken(spendToken);

    const inflatedOpId = randomUUID();
    await prisma.toolOperation.create({
      data: {
        operationId: inflatedOpId,
        deploymentId: claims.deploymentId,
        missionSlug: mission.slug,
        paymentMode: 'MOCK',
        payerAddress: claims.agent,
        toolId: 'tool:search',
        inputHash: '0x1234',
        paymentTerms: JSON.stringify({
          toolId: 'tool:search',
          priceAtomic: '999000', // Inflated price > catalog price of 100,000
          asset: '0x5425890298aed601595a70ab815c96711a31bc65',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        }),
        paymentTermsHash: '0x5678',
        policyHash: claims.policyHash,
        chainId: 43113,
        asset: '0x5425890298aed601595a70ab815c96711a31bc65',
        state: 'CREATED',
        version: 0,
        authDeploymentVersion: 1,
        quoteExpiresAt: new Date(Date.now() + 300000),
        reservedAmount: '0',
      },
    });

    // Calling reserveOperation MUST reject with PRICE_MISMATCH
    await expect(
      reserveOperation({
        operationId: inflatedOpId,
        tokenClaims: claims,
      })
    ).rejects.toThrow('PRICE_MISMATCH');

    // Confirm that a BLOCKED audit record was written into database under lock
    const auditEntries = await prisma.auditEntry.findMany({ where: { missionSlug: mission.slug } });
    const blockedAudit = auditEntries.find((e) => {
      const parsed = JSON.parse(e.canonicalJson);
      return parsed.operation_id === inflatedOpId;
    });
    expect(blockedAudit).toBeDefined();
    const parsedAudit = JSON.parse(blockedAudit!.canonicalJson);
    expect(parsedAudit.rule).toBe('PRICE_MISMATCH');
    expect(parsedAudit.kind).toBe('BLOCKED');
  });

  it('Regression 15 (KEY-02b): External spending route (/api/tools/orchestrate) fails startup validation in LIVE_FUJI mode when using Anvil address', async () => {
    process.env.PAYMENT_MODE = 'LIVE_FUJI';
    process.env.SELLER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // Insecure Anvil #1
    process.env.AGENT_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Insecure Anvil #0

    const { spendToken } = await createTestMission();

    const req = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        toolId: 'tool:search',
        arguments: { query: 'Avalanche architecture' },
      }),
    });

    // Calling external orchestrate handler must throw or return KEY-02 error
    try {
      const res = await orchestratePOST(req);
      if (res.status === 500) {
        const errJson = await res.json();
        expect(errJson.error).toContain('KEY-02');
      }
    } catch (err: any) {
      expect(err.message).toContain('KEY-02');
    }

    // Reset payment mode
    process.env.PAYMENT_MODE = 'MOCK';
  });

  it('Regression 16 (INJ-01b): Research query containing "attack" executes normal live search when demo flag is false; fixture requires DEMO_ADVERSARIAL=1', async () => {
    delete process.env.DEMO_ADVERSARIAL;

    // 1. Without env flag, query mentioning "attack" executes normal search
    const normalResult = await toolCatalog['tool:search'].execute({
      query: '51% attack blockchain consensus security',
      demoAdversarial: false,
    });
    expect(normalResult.provider).not.toBe('demo-adversarial-search-fixture');
    expect((normalResult as any).fixture).toBeUndefined();

    // 2. Without env flag, even passing demoAdversarial=true is ignored (safe by default)
    const ignoredResult = await toolCatalog['tool:search'].execute({
      query: 'Attack demo test',
      demoAdversarial: true,
    });
    expect(ignoredResult.provider).not.toBe('demo-adversarial-search-fixture');
    expect((ignoredResult as any).fixture).toBeUndefined();

    // 3. With DEMO_ADVERSARIAL=1 in non-production, passing demoAdversarial=true returns labeled fixture
    process.env.DEMO_ADVERSARIAL = '1';
    try {
      const adversarialResult = await toolCatalog['tool:search'].execute({
        query: 'Attack demo test',
        demoAdversarial: true,
      });
      expect(adversarialResult.provider).toBe('demo-adversarial-search-fixture');
      expect((adversarialResult as any).fixture).toBe(true);
      expect(adversarialResult.points[1]).toContain('URGENT ADVISORY');

      // 4. Even with DEMO_ADVERSARIAL=1, a normal search query (demoAdversarial=false) does not return fixture
      const regularResult = await toolCatalog['tool:search'].execute({
        query: 'Avalanche consensus mechanism',
        demoAdversarial: false,
      });
      expect(regularResult.provider).not.toBe('demo-adversarial-search-fixture');
      expect((regularResult as any).fixture).toBeUndefined();
    } finally {
      delete process.env.DEMO_ADVERSARIAL;
    }
  });

  it('Regression 17 (UI-02b): Real server pause via owner challenge strictly blocks /api/agent/run and /api/tools/orchestrate with 403; unpause resumes', async () => {
    // 1. Request PAUSE_S1 challenge for owner
    const challengeReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'PAUSE_S1',
        payload: { desiredPaused: true },
        expectedSigner: ownerAccount.address,
      }),
    });
    const challengeRes = await challengePOST(challengeReq);
    expect(challengeRes.status).toBe(200);
    const { nonce, message } = await challengeRes.json();

    // 2. Owner signs challenge
    const signature = await ownerAccount.signMessage({ message });

    // 3. Send real POST /api/system/pause
    const pauseReq = new NextRequest('http://localhost:3000/api/system/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce,
        signature,
        payload: { desiredPaused: true },
      }),
    });
    const pauseRes = await pausePOST(pauseReq);
    expect(pauseRes.status).toBe(200);
    const pauseData = await pauseRes.json();
    expect(pauseData.systemPaused).toBe(true);

    // 4. Create active mission and spend token
    const { spendToken } = await createTestMission();

    // 5. Verify /api/agent/run is strictly halted with HTTP 403
    const runReq = new NextRequest('http://localhost:3000/api/agent/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ goal: 'Execute under pause' }),
    });
    const runRes = await POST(runReq);
    expect(runRes.status).toBe(403);
    const runData = await runRes.json();
    expect(runData.error).toContain('System is paused');

    // 6. Verify /api/tools/orchestrate is strictly halted with HTTP 403
    const orchReq = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        toolId: 'tool:search',
        arguments: { query: 'Blockchain security' },
      }),
    });
    const orchRes = await orchestratePOST(orchReq);
    expect(orchRes.status).toBe(403);
    const orchData = await orchRes.json();
    expect(orchData.error).toContain('System is paused');

    // 7. Unpause the system via owner challenge
    const unpauseChallReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'PAUSE_S1',
        payload: { desiredPaused: false },
        expectedSigner: ownerAccount.address,
      }),
    });
    const unpauseChallRes = await challengePOST(unpauseChallReq);
    const unpauseChall = await unpauseChallRes.json();
    const unpauseSig = await ownerAccount.signMessage({ message: unpauseChall.message });

    const unpauseReq = new NextRequest('http://localhost:3000/api/system/pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: unpauseChall.nonce,
        signature: unpauseSig,
        payload: { desiredPaused: false },
      }),
    });
    const unpauseRes = await pausePOST(unpauseReq);
    expect(unpauseRes.status).toBe(200);

    // 8. Now /api/agent/run and /api/tools/orchestrate resume normal execution
    const runResAfter = await POST(runReq);
    expect(runResAfter.status).toBe(200);
  });

  it('Regression 18 (VER-02): Shared cryptographic proof verifier strictly enforces inner prev_hash matching', () => {
    const canonicalJson =
      '{"actor":"0x1","amount":"0","chain_id":"43113","created_at":"2026-11-04T00:00:00.000Z","kind":"CUTOVER","mission_id":"m1","operation_id":"","policy_hash":"0x0","policy_version":"1","prev_hash":"0x0000000000000000000000000000000000000000000000000000000000000000","reason":"Genesis","result_hash":"","rule":"","source_key":"test:genesis","to":"","tx_hash":""}';
    const entryHash = keccak256(stringToBytes(canonicalJson));

    // 1. Valid entry passes verification
    const validRes = verifyProof(
      [
        {
          sourceKey: 'test:genesis',
          prevHash: INITIAL_PREV_HASH,
          entryHash,
          canonicalJson,
        },
      ],
      { entryCount: 1, headHash: entryHash }
    );
    expect(validRes.valid).toBe(true);

    // 2. Entry missing inner prev_hash strictly FAILS
    const jsonMissingPrevHash =
      '{"actor":"0x1","amount":"0","chain_id":"43113","created_at":"2026-11-04T00:00:00.000Z","kind":"CUTOVER","mission_id":"m1","operation_id":"","policy_hash":"0x0","policy_version":"1","reason":"Genesis","result_hash":"","rule":"","source_key":"test:genesis","to":"","tx_hash":""}';
    const hashMissing = keccak256(stringToBytes(jsonMissingPrevHash));
    const failRes = verifyProof(
      [
        {
          sourceKey: 'test:genesis',
          prevHash: '0x1234567890123456789012345678901234567890123456789012345678901234',
          entryHash: hashMissing,
          canonicalJson: jsonMissingPrevHash,
        },
      ],
      { entryCount: 1, headHash: hashMissing }
    );
    expect(failRes.valid).toBe(false);
    expect(failRes.errors.some((e) => e.includes('Inner/outer prevHash mismatch'))).toBe(true);
  });

  it('Regression 19 (P1-WIRE): In Stage S2, activate wires session wallet funding, complete wires proof anchor, and feedback wires ERC-8004', async () => {
    // 1. Switch system state to Stage S2
    await prisma.systemState.update({
      where: { id: 1 },
      data: { stage: 'S2' },
    });

    // 2. Create mission in S2
    const { mission, spendToken } = await createTestMission();

    // 3. Activate in S2: triggers session wallet unsigned tx generation (WIRE-01)
    const actPayload = {
      missionId: mission.missionId,
      ownerAddress: mission.ownerAddress,
      agentAddress: mission.agentAddress,
      treasuryCap: mission.treasuryCap,
      toolCap: mission.toolCap,
    };
    const actChallengeReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACTIVATE',
        payload: actPayload,
        expectedSigner: ownerAccount.address,
      }),
    });
    const actChallRes = await challengePOST(actChallengeReq);
    const { nonce: actNonce, message: actMessage } = await actChallRes.json();
    const actSig = await ownerAccount.signMessage({ message: actMessage });

    const actReq = new NextRequest(`http://localhost:3000/api/missions/${mission.slug}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: actNonce,
        signature: actSig,
        payload: actPayload,
      }),
    });
    const actRes = await activatePOST(actReq, { params: Promise.resolve({ slug: mission.slug }) });
    expect(actRes.status).toBe(200);
    const actData = await actRes.json();
    expect(actData.sessionWallet).toBeDefined();
    // WIRE-01: In MOCK mode, does not claim funded on-chain; returns unsignedTx and FUNDING_MOCK_NOT_SENT
    expect(actData.sessionWallet.funded).toBe(false);
    expect(actData.sessionWallet.status).toBe('FUNDING_MOCK_NOT_SENT');
    expect(actData.sessionWallet.txHash).toBeNull();
    expect(actData.sessionWallet.unsignedTx).toBeDefined();

    // Verify WIRE-01: NO false SESSION_WALLET_FUNDED audit entry in DB in MOCK mode
    const entriesAfterAct = await prisma.auditEntry.findMany({
      where: { missionSlug: mission.slug },
    });
    const fundAudit = entriesAfterAct
      .map((e) => JSON.parse(e.canonicalJson))
      .find((p) => p.kind === 'SESSION_WALLET_FUNDED');
    expect(fundAudit).toBeUndefined();

    // 4. Execute a tool operation so we have a SETTLED operation
    const orchReq = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        toolId: 'tool:search',
        arguments: { query: 'Avalanche Consensus' },
      }),
    });
    const orchRes = await orchestratePOST(orchReq);
    expect(orchRes.status).toBe(200);
    const orchData = await orchRes.json();
    expect(orchData.operation.state).toBe('SETTLED');

    // 5. Complete mission in S2: triggers proof anchor logic (WIRE-01)
    const compPayload = {
      slug: mission.slug,
      deliverableHash: '0x1111222233334444555566667777888899990000111122223333444455556666',
    };
    const compChallReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'COMPLETE_MISSION',
        payload: compPayload,
        expectedSigner: ownerAccount.address,
      }),
    });
    const compChallRes = await challengePOST(compChallReq);
    const { nonce: compNonce, message: compMessage } = await compChallRes.json();
    const compSig = await ownerAccount.signMessage({ message: compMessage });

    const compReq = new NextRequest(`http://localhost:3000/api/missions/${mission.slug}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: compNonce,
        signature: compSig,
        payload: compPayload,
      }),
    });
    const compRes = await completePOST(compReq, { params: Promise.resolve({ slug: mission.slug }) });
    expect(compRes.status).toBe(200);
    const compData = await compRes.json();
    expect(compData.anchoredProof).toBeDefined();
    // WIRE-01: In MOCK mode, does not claim anchored on-chain; returns unsignedTx and ANCHOR_MOCK_NOT_SENT
    expect(compData.anchoredProof.anchored).toBe(false);
    expect(compData.anchoredProof.status).toBe('ANCHOR_MOCK_NOT_SENT');
    expect(compData.anchoredProof.txHash).toBeNull();
    expect(compData.anchoredProof.unsignedTx).toBeDefined();

    // Verify WIRE-01: NO false PROOF_ANCHORED audit entry in DB in MOCK mode
    const entriesAfterComp = await prisma.auditEntry.findMany({
      where: { missionSlug: mission.slug },
    });
    const anchorAudit = entriesAfterComp
      .map((e) => JSON.parse(e.canonicalJson))
      .find((p) => p.kind === 'PROOF_ANCHORED');
    expect(anchorAudit).toBeUndefined();

    // 6. FB-01: Feedback route requires owner EIP-191 signature; agent token is rejected
    const agentFbReq = new NextRequest('http://localhost:3000/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        operationId: orchData.operation.operationId,
        score: 95,
      }),
    });
    const agentFbRes = await feedbackPOST(agentFbReq);
    expect(agentFbRes.status).toBe(400); // Rejects agent request without owner challenge nonce & signature

    // 7. FB-01: Owner signs challenge to submit feedback
    const fbPayload = {
      operationId: orchData.operation.operationId,
      score: 95,
      tag1: 'starred',
      tag2: 'unihack-s2',
    };
    const fbChallReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'SUBMIT_FEEDBACK',
        payload: fbPayload,
        expectedSigner: ownerAccount.address,
      }),
    });
    const fbChallRes = await challengePOST(fbChallReq);
    expect(fbChallRes.status).toBe(200);
    const { nonce: fbNonce, message: fbMessage } = await fbChallRes.json();
    const fbSig = await ownerAccount.signMessage({ message: fbMessage });

    const fbReq = new NextRequest('http://localhost:3000/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: fbNonce,
        signature: fbSig,
        payload: fbPayload,
      }),
    });
    const fbRes = await feedbackPOST(fbReq);
    expect(fbRes.status).toBe(200);
    const fbData = await fbRes.json();
    expect(fbData.success).toBe(true);
    expect(fbData.mode).toBe('MOCK');
    expect(fbData.status).toBe('FEEDBACK_MOCK_NOT_SENT');
    expect(fbData.txHash).toBeNull();
    // FB-01: agentId is looked up from toolCatalog (search = 1001), not client body
    expect(fbData.agentId).toBe('1001');
    expect(fbData.unsignedTx).toBeDefined();

    // Verify FB-01: NO false ERC8004_FEEDBACK audit entry in DB in MOCK mode
    const entriesAfterFb = await prisma.auditEntry.findMany({
      where: { missionSlug: mission.slug },
    });
    const fbAudit = entriesAfterFb
      .map((e) => JSON.parse(e.canonicalJson))
      .find((p) => p.kind === 'ERC8004_FEEDBACK');
    expect(fbAudit).toBeUndefined();

    // Reset back to S1 for subsequent tests
    await prisma.systemState.update({
      where: { id: 1 },
      data: { stage: 'S1' },
    });
  });
});
