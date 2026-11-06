import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/agent/run/route';
import { prisma } from '../lib/db';
import { clearDatabase, createTestMission } from './setup';
import { issueSpendToken } from '../lib/auth';
import { hashUtf8, normalizeAddress } from '../lib/chain';

describe('AG-01: Agent Run Security Boundaries & Real Settlement Rails', () => {
  beforeEach(async () => {
    await clearDatabase();
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
});
