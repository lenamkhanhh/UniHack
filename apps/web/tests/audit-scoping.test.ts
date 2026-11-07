import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../lib/db';
import { issueSpendToken } from '../lib/auth';
import { appendAuditEntry, INITIAL_PREV_HASH } from '../lib/audit';
import { GET as getAudit } from '../app/api/audit/route';
import { GET as getVerify } from '../app/api/verify/[missionId]/route';
import { NextRequest } from 'next/server';

describe('WOW-F9: Audit & Verify Scoping for Unpublished vs Published Missions', () => {
  const unpublishedSlug = `unpub_${Date.now()}`;
  const publishedSlug = `pub_${Date.now()}`;
  let unpubToken = '';

  beforeAll(async () => {
    process.env.APP_ORIGIN = 'http://localhost:3100';
    process.env.MISSION_TOKEN_SECRET = 'test-mission-token-secret-must-be-at-least-32-chars-long!';
    process.env.DEPLOYMENT_ID = 'unihack-test';
    // 1. Create an unpublished mission
    await prisma.mission.create({
      data: {
        slug: unpublishedSlug,
        missionId: `0x${unpublishedSlug.padEnd(64, '0')}`,
        ownerAddress: '0x00000000000000000000000000000000000A11CE',
        agentAddress: '0x00000000000000000000000000000000000A6E47',
        policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        toolCap: '5000000',
        treasuryCap: '10000000',
        spentTool: '0',
        reservedTool: '0',
        expiresAt: new Date(Date.now() + 3600000),
        status: 'ACTIVE',
        publicPublished: false, // UNPUBLISHED
        configVersion: 1,
      },
    });

    // Append an audit entry to unpublished mission
    await appendAuditEntry(prisma, {
      actor: '0x00000000000000000000000000000000000A6E47',
      amount: '100000',
      chain_id: '43113',
      created_at: new Date().toISOString(),
      kind: 'TOOL_PAID',
      mission_id: unpublishedSlug,
      operation_id: `op_${unpublishedSlug}`,
      policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      policy_version: '1',
      reason: 'Secret unpublished operation',
      result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      rule: '',
      source_key: `src_${unpublishedSlug}`,
      to: '0x2222222222222222222222222222222222222222',
      tx_hash: '',
    });

    // 2. Create a published mission
    await prisma.mission.create({
      data: {
        slug: publishedSlug,
        missionId: `0x${publishedSlug.padEnd(64, '0')}`,
        ownerAddress: '0x00000000000000000000000000000000000A11CE',
        agentAddress: '0x00000000000000000000000000000000000A6E47',
        policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        toolCap: '5000000',
        treasuryCap: '10000000',
        spentTool: '0',
        reservedTool: '0',
        expiresAt: new Date(Date.now() + 3600000),
        status: 'ACTIVE',
        publicPublished: true, // PUBLISHED
        configVersion: 1,
      },
    });

    await appendAuditEntry(prisma, {
      actor: '0x00000000000000000000000000000000000A6E47',
      amount: '200000',
      chain_id: '43113',
      created_at: new Date().toISOString(),
      kind: 'TOOL_PAID',
      mission_id: publishedSlug,
      operation_id: `op_${publishedSlug}`,
      policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      policy_version: '1',
      reason: 'Public research operation',
      result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      rule: '',
      source_key: `src_${publishedSlug}`,
      to: '0x2222222222222222222222222222222222222222',
      tx_hash: '',
    });

    unpubToken = await issueSpendToken({
      deploymentId: 'unihack-test',
      stage: 'S2',
      guardAddress: '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3',
      authVersion: 1,
      missionSlug: unpublishedSlug,
      missionId: `0x${unpublishedSlug.padEnd(64, '0')}`,
      ownerAddress: '0x00000000000000000000000000000000000A11CE',
      agentAddress: '0x00000000000000000000000000000000000A6E47',
      missionConfigVersion: 1,
      policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      missionExpiresAt: new Date(Date.now() + 3600000),
    });
  });

  it('WOW-F9: Unauthenticated callers cannot see unpublished mission in ?feed=1 or ?missionSlug=', async () => {
    // 1. ?feed=1 without token -> should NOT contain unpublishedSlug entries
    const feedReq = new NextRequest('http://localhost:3100/api/audit?feed=1');
    const feedRes = await getAudit(feedReq);
    expect(feedRes.status).toBe(200);
    const feedJson = await feedRes.json();
    const hasUnpublished = feedJson.entries.some((e: any) => e.sourceKey === `src_${unpublishedSlug}`);
    expect(hasUnpublished).toBe(false);

    // Published mission CAN be seen in feed
    const hasPublished = feedJson.entries.some((e: any) => e.sourceKey === `src_${publishedSlug}`);
    expect(hasPublished).toBe(true);

    // 2. ?missionSlug=unpublishedSlug without token -> returns empty entries
    const slugReq = new NextRequest(`http://localhost:3100/api/audit?missionSlug=${unpublishedSlug}`);
    const slugRes = await getAudit(slugReq);
    expect(slugRes.status).toBe(200);
    const slugJson = await slugRes.json();
    expect(slugJson.entries.length).toBe(0);

    // 3. ?missionSlug=publishedSlug without token -> returns the published entries
    const pubSlugReq = new NextRequest(`http://localhost:3100/api/audit?missionSlug=${publishedSlug}`);
    const pubSlugRes = await getAudit(pubSlugReq);
    expect(pubSlugRes.status).toBe(200);
    const pubSlugJson = await pubSlugRes.json();
    expect(pubSlugJson.entries.length).toBeGreaterThan(0);
  });

  it('WOW-F9: /api/verify/[missionId] returns 404 for unpublished mission without token, but 200 with token or when published', async () => {
    // 1. Unpublished mission without token -> 404
    const unpubReq = new NextRequest(`http://localhost:3100/api/verify/${unpublishedSlug}`);
    const unpubRes = await getVerify(unpubReq, { params: Promise.resolve({ missionId: unpublishedSlug }) });
    expect(unpubRes.status).toBe(404);
    const unpubJson = await unpubRes.json();
    expect(unpubJson.error).toContain('Không tìm thấy mission');

    // 2. Unpublished mission WITH valid token -> 200
    const authReq = new NextRequest(`http://localhost:3100/api/verify/${unpublishedSlug}`, {
      headers: { authorization: `Bearer ${unpubToken}` },
    });
    const authRes = await getVerify(authReq, { params: Promise.resolve({ missionId: unpublishedSlug }) });
    expect(authRes.status).toBe(200);
    const authJson = await authRes.json();
    expect(authJson.success).toBe(true);
    expect(authJson.entries.length).toBeGreaterThan(0);

    // 3. Published mission without token -> 200
    const pubReq = new NextRequest(`http://localhost:3100/api/verify/${publishedSlug}`);
    const pubRes = await getVerify(pubReq, { params: Promise.resolve({ missionId: publishedSlug }) });
    expect(pubRes.status).toBe(200);
    const pubJson = await pubRes.json();
    expect(pubJson.success).toBe(true);
    expect(pubJson.entries.length).toBeGreaterThan(0);
  });
});
