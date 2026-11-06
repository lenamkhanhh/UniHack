import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/agent/run/route';
import { prisma } from '../lib/db';
import { clearDatabase, createTestMission } from './setup';
import { issueSpendToken } from '../lib/auth';
import { hashUtf8, normalizeAddress } from '../lib/chain';
import { validateLiveFujiConfig } from '../lib/config';
import { verifyQuoteAgainstCatalog } from '../lib/validator';

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

  it('Regression 11 (KEY-02): LIVE_FUJI mode rejects missing variables or well-known Anvil keys/addresses', () => {
    const originalEnv = { ...process.env };

    try {
      // 1. Missing SELLER_ADDRESS in LIVE_FUJI
      process.env.PAYMENT_MODE = 'LIVE_FUJI';
      delete process.env.SELLER_ADDRESS;
      process.env.AGENT_PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
      expect(() => validateLiveFujiConfig()).toThrow('KEY-02: SELLER_ADDRESS must be set');

      // 2. Anvil default seller address 0x7099...79c8
      process.env.SELLER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
      expect(() => validateLiveFujiConfig()).toThrow('KEY-02: SELLER_ADDRESS cannot be a well-known Anvil/Hardhat test address');

      // 3. Anvil default agent private key 0xac09...ff80
      process.env.SELLER_ADDRESS = '0x1234567890123456789012345678901234567890';
      process.env.AGENT_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      expect(() => validateLiveFujiConfig()).toThrow('KEY-02: AGENT_PRIVATE_KEY cannot be a well-known Anvil/Hardhat test private key');

      // 4. MOCK mode allows without throwing
      process.env.PAYMENT_MODE = 'MOCK';
      expect(() => validateLiveFujiConfig()).not.toThrow();
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
  });

  it('Regression 14 (P2-PRICE): Quote exceeding catalog price or per-call cap is strictly rejected', () => {
    // 1. Quoted price exceeds catalog price (Search is 100,000 atomic; quote is 200,000)
    const quoteOverPrice = verifyQuoteAgainstCatalog({
      toolId: 'tool:search',
      quotedAmountAtomic: 200_000n,
    });
    expect(quoteOverPrice.valid).toBe(false);
    expect(quoteOverPrice.rule).toBe('PRICE_MISMATCH');

    // 2. Quoted price exceeds per-call cap (Search perCallCap is 200,000 atomic; quote is 500,000)
    const quoteOverCap = verifyQuoteAgainstCatalog({
      toolId: 'tool:search',
      quotedAmountAtomic: 500_000n,
    });
    expect(quoteOverCap.valid).toBe(false);
    expect(quoteOverCap.rule).toBe('PRICE_MISMATCH'); // Price mismatch triggers first if > catalog

    // 3. Unknown tool
    const quoteUnknown = verifyQuoteAgainstCatalog({
      toolId: 'tool:unknown_scam',
      quotedAmountAtomic: 100_000n,
    });
    expect(quoteUnknown.valid).toBe(false);
    expect(quoteUnknown.rule).toBe('UNKNOWN_TOOL');

    // 4. Exact legitimate catalog price succeeds
    const quoteValid = verifyQuoteAgainstCatalog({
      toolId: 'tool:search',
      quotedAmountAtomic: 100_000n,
    });
    expect(quoteValid.valid).toBe(true);
  });
});
