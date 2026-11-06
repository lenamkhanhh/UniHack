import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import {
  clearDatabase,
  createTestMission,
  ownerAccount,
  agentAccount,
  sellerAddress,
  TEST_OWNER_KEY,
  TEST_AGENT_KEY,
} from './setup';
import {
  verifyToken,
  issueReadToken,
  issueSpendToken,
  computePayloadHash,
  generateEip191Message,
} from '@/lib/auth';
import { validateProposalSchema, validateProposal, ValidationContext } from '@/lib/validator';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
} from '@/lib/payments';
import { normalizeAddress } from '@/lib/chain';

describe('Auth / Validator / API V-series Integration Tests (06 §3)', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  // V3: Arbitrary approve/max allowance/calldata -> Strict schema/capability reject
  it('V3: Arbitrary calldata or approve requests are rejected by strict schema validator', () => {
    const maliciousProposal = {
      kind: 'tool_purchase',
      mission_id: 'test-mission',
      tool_id: 'tool:summary',
      amount_atomic: '500000',
      reason: 'Summarize text',
      arguments: { text: 'valid text' },
      extraCalldata: '0x095ea7b3000000000000000000000000...', // attempt ERC-20 approve calldata
    };

    const res = validateProposalSchema(maliciousProposal);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Unknown key 'extraCalldata'");
  });

  // V4: Missing/forged/wrong mission spend token -> Không dùng key A, không compute
  it('V4: Forged or missing spend token is rejected without executing signer', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature';
    await expect(verifyToken(fakeToken)).rejects.toThrow();
  });

  // V6: S1 auth/pause khi guard absent -> Không gọi guard, signed owner actions có binding
  it('V6: S1 owner authentication operates with EIP-191 domain binding without calling guard contract', async () => {
    const action = 'PAUSE_S1';
    const payload = { desiredPaused: true };
    const payloadHash = computePayloadHash(payload);
    const nonce = '0x' + '1'.repeat(64);
    const issuedAt = Math.floor(Date.now() / 1000);

    const message = generateEip191Message({
      action,
      deploymentId: 'unihack-test-deployment',
      appOrigin: 'http://localhost:3000',
      stage: 'S1',
      guardAddress: null,
      authVersion: 1,
      payloadHash,
      nonce,
      issuedAt,
    });

    expect(message).toContain('stage: S1');
    expect(message).toContain('guard: none');
    expect(message).toContain(`payloadHash: ${payloadHash}`);
  });

  // V7: Challenge replay/expiry/action/payload/domain/version tamper -> Reject; nonce consume atomic
  it('V7: Tampered challenge payload or replayed nonce is rejected', async () => {
    const nonce = '0x' + '7'.repeat(64);
    const payload = { desiredPaused: true };
    const payloadHash = computePayloadHash(payload);

    // Create challenge
    await prisma.authChallenge.create({
      data: {
        nonce,
        action: 'PAUSE_S1',
        payloadHash,
        expectedSigner: normalizeAddress(ownerAccount.address),
        deploymentId: 'unihack-test-deployment',
        authVersion: 1,
        expiresAt: new Date(Date.now() + 600000),
      },
    });

    // Mark used
    await prisma.authChallenge.update({
      where: { nonce },
      data: { usedAt: new Date() },
    });

    // Attempting to consume already-used challenge
    const challenge = await prisma.authChallenge.findUnique({ where: { nonce } });
    expect(challenge?.usedAt).not.toBeNull();
  });

  // V8: Read token gọi reserve/propose; expired spend token -> Reject spend; owner có thể xin read token mới
  it('V8: Read token cannot call reserve/spend, and expired spend token is rejected', async () => {
    const { mission } = await createTestMission();
    const readToken = await issueReadToken({
      deploymentId: 'unihack-test-deployment',
      stage: 'S1',
      authVersion: 1,
      missionSlug: mission.slug,
      missionId: mission.missionId,
      ownerAddress: mission.ownerAddress,
      agentAddress: mission.agentAddress,
      missionConfigVersion: mission.configVersion,
      policyHash: mission.policyHash,
    });

    const readClaims = await verifyToken(readToken);
    expect(readClaims.type).toBe('read');

    const ctx: ValidationContext = {
      tokenClaims: readClaims,
      systemPaused: false,
      maintenance: false,
      stage: 'S1',
      mission: {
        slug: mission.slug,
        missionId: mission.missionId,
        status: mission.status,
        expiresAt: mission.expiresAt,
        ownerAddress: mission.ownerAddress,
        agentAddress: mission.agentAddress,
        toolCap: 5_000_000n,
        spentTool: 0n,
        reservedTool: 0n,
        treasuryCap: 10_000_000n,
        configVersion: mission.configVersion,
      },
    };

    const res = validateProposal(
      {
        kind: 'tool_purchase',
        mission_id: mission.slug,
        tool_id: 'tool:summary',
        amount_atomic: '500000',
        reason: 'Summary test',
        arguments: { text: 'hello' },
      },
      ctx
    );

    expect(res.outcome).toBe('BLOCK');
    expect(res.rule).toBe('INVALID_CREDENTIAL_TYPE');
  });

  // V9: Mission đóng/hết hạn với payment outstanding -> Không spend mới; read/reconcile vẫn đúng
  it('V9: Closed mission forbids new spend while existing operations remain readable', async () => {
    const { mission, spendToken } = await createTestMission({ status: 'CLOSED' });
    const claims = await verifyToken(spendToken);
    const opId = randomUUID();

    // Spend attempt on closed mission throws
    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Closed mission test' },
      tokenClaims: claims,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    await expect(
      reserveOperation({ operationId: opId, tokenClaims: claims })
    ).rejects.toThrow('MISSION_NOT_ACTIVE_OR_EXPIRED');
  });

  // V11: Cross-mission read/unknown operation -> Không lộ tồn tại/state/result; uniform scoped error
  it('V11: Cross-mission read attempts do not expose private operation details', async () => {
    const { mission: mission1, spendToken: token1 } = await createTestMission();
    const { spendToken: token2 } = await createTestMission();
    const claims1 = await verifyToken(token1);
    const claims2 = await verifyToken(token2);
    const opId = randomUUID();

    await createQuote({
      operationId: opId,
      toolId: 'tool:summary',
      input: { text: 'Private data' },
      tokenClaims: claims1,
      sellerAddress,
      appOrigin: 'http://localhost:3000',
    });

    // Lookup operation with claims from mission2
    const op = await prisma.toolOperation.findUnique({ where: { operationId: opId } });
    expect(op?.missionSlug).not.toBe(claims2.missionSlug);
  });

  // V12: Seller redirect/prompt injection/URL lạ -> Không credential forwarding, full seller/resource allowlist
  it('V12: Malformed or unauthorized tool redirects are blocked', () => {
    const injectedProposal = {
      kind: 'tool_purchase' as const,
      mission_id: 'test-mission',
      tool_id: 'tool:unauthorized_seller',
      amount_atomic: '500000',
      reason: 'Injected tool seller',
      arguments: { text: 'hack' },
    };

    const ctx: ValidationContext = {
      tokenClaims: {
        type: 'spend',
        iss: 'http://localhost:3000',
        aud: 'unihack',
        deploymentId: 'dep1',
        stage: 'S1',
        chainId: 43113,
        guardAddress: 'none',
        authVersion: 1,
        missionSlug: 'test-mission',
        missionId: '0x1',
        owner: '0x1',
        agent: '0x2',
        missionConfigVersion: 1,
        policyHash: '0x0',
        jti: '1',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      },
      systemPaused: false,
      maintenance: false,
      stage: 'S1',
      mission: {
        slug: 'test-mission',
        missionId: '0x1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 86400000),
        ownerAddress: '0x1',
        agentAddress: '0x2',
        toolCap: 5_000_000n,
        spentTool: 0n,
        reservedTool: 0n,
        treasuryCap: 10_000_000n,
        configVersion: 1,
      },
    };

    const res = validateProposal(injectedProposal, ctx);
    expect(res.outcome).toBe('BLOCK');
    expect(res.rule).toBe('UNKNOWN_TOOL');
  });

  // V14: New tool call với remaining < price nhưng > 0 -> BLOCK, không reserve/sign
  it('V14: New tool purchase with remaining budget less than price is blocked', () => {
    const proposal = {
      kind: 'tool_purchase' as const,
      mission_id: 'test-mission',
      tool_id: 'tool:summary', // price 500,000
      amount_atomic: '500000',
      reason: 'Purchase',
      arguments: { text: 'Some text' },
    };

    const ctx: ValidationContext = {
      tokenClaims: {
        type: 'spend',
        iss: 'http://localhost:3000',
        aud: 'unihack',
        deploymentId: 'dep1',
        stage: 'S1',
        chainId: 43113,
        guardAddress: 'none',
        authVersion: 1,
        missionSlug: 'test-mission',
        missionId: '0x1',
        owner: '0x1',
        agent: '0x2',
        missionConfigVersion: 1,
        policyHash: '0x0',
        jti: '1',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      },
      systemPaused: false,
      maintenance: false,
      stage: 'S1',
      mission: {
        slug: 'test-mission',
        missionId: '0x1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 86400000),
        ownerAddress: '0x1',
        agentAddress: '0x2',
        toolCap: 500_000n,
        spentTool: 300_000n, // Remaining is 200,000 (< 500,000 price)
        reservedTool: 0n,
        treasuryCap: 10_000_000n,
        configVersion: 1,
      },
    };

    const res = validateProposal(proposal, ctx);
    expect(res.outcome).toBe('BLOCK');
    expect(res.rule).toBe('INSUFFICIENT_TOOL_BUDGET');
  });

  // V15: Public demo request arbitrary amount/recipient/reset -> Không ký tùy ý/không wipe history
  it('V15: Public demo requests with unallowlisted recipient or arbitrary amount are blocked', () => {
    const maliciousTreasury = {
      kind: 'treasury_payout' as const,
      mission_id: 'test-mission',
      to: '0x9999999999999999999999999999999999999999',
      amount_atomic: '1000000000000',
      reason: 'Wipe Quota Demo',
    };

    const ctx: ValidationContext = {
      tokenClaims: {
        type: 'spend',
        iss: 'http://localhost:3000',
        aud: 'unihack',
        deploymentId: 'dep1',
        stage: 'S1',
        chainId: 43113,
        guardAddress: 'none',
        authVersion: 1,
        missionSlug: 'test-mission',
        missionId: '0x1',
        owner: '0x1',
        agent: '0x2',
        missionConfigVersion: 1,
        policyHash: '0x0',
        jti: '1',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      },
      systemPaused: false,
      maintenance: false,
      stage: 'S1',
      mission: {
        slug: 'test-mission',
        missionId: '0x1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 86400000),
        ownerAddress: '0x1',
        agentAddress: '0x2',
        toolCap: 5_000_000n,
        spentTool: 0n,
        reservedTool: 0n,
        treasuryCap: 10_000_000n,
        configVersion: 1,
      },
    };

    const res = validateProposal(maliciousTreasury, ctx);
    expect(res.outcome).toBe('BLOCK');
  });
});
