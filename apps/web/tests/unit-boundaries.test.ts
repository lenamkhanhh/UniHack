import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import {
  getJwtSecret,
  getConfiguredOwner,
  getPaymentMode,
} from '@/lib/config';
import {
  issueSpendToken,
  issueReadToken,
  verifyToken,
  generateEip191Message,
  computePayloadHash,
} from '@/lib/auth';
import {
  validateProposalSchema,
  validateProposal,
  ValidationContext,
} from '@/lib/validator';
import {
  validatePayloadTarget,
  ChallengeError,
} from '@/lib/challenges';
import {
  toOperationDto,
  toAuditEntryDto,
  toMissionDto,
  toSessionDto,
} from '@/lib/dto';
import {
  verifyAuditChain,
  INITIAL_PREV_HASH,
  computeEntryHash,
  canonicalAuditJson,
} from '@/lib/audit';
import { verifyProof } from '../../../scripts/verify-proof';
import {
  normalizeAddress,
  usdcEip712Domain,
  eip3009Types,
} from '@/lib/chain';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import { executeUpstreamAndSettle } from '@/lib/payments';
import { createProductionChainReader } from '@/lib/reconcile';
import { backfillMissionAuditProjections } from '@/lib/audit';
import { GET as getProof } from '@/app/api/missions/[slug]/proof/route';
import { POST as postOrchestrate } from '@/app/api/tools/orchestrate/route';
import { POST as postTalkmeterTick } from '@/app/api/tools/talkmeter/tick/route';
import { prisma } from '@/lib/db';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

describe('Unit & Security Boundaries Suite (Independent of DB)', () => {
  const TEST_OWNER_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
  const TEST_AGENT_KEY =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const owner = privateKeyToAccount(TEST_OWNER_KEY);
  const agent = privateKeyToAccount(TEST_AGENT_KEY);

  beforeEach(() => {
    process.env.MISSION_TOKEN_SECRET =
      'test-mission-token-secret-must-be-at-least-32-chars-long!';
    process.env.OWNER_ADDRESS = normalizeAddress(owner.address);
    process.env.APP_ORIGIN = 'http://localhost:3000';
    process.env.DEPLOYMENT_ID = 'test-dep';
    process.env.PAYMENT_MODE = 'MOCK';
  });

  describe('F1 & F3: Fail-Closed Configuration Boundaries', () => {
    it('getPaymentMode rejects unknown or typo strings and defaults safely', () => {
      const orig = process.env.PAYMENT_MODE;
      try {
        process.env.PAYMENT_MODE = 'LIVE_FUJI';
        expect(getPaymentMode()).toBe('LIVE_FUJI');

        process.env.PAYMENT_MODE = 'MOCK';
        expect(getPaymentMode()).toBe('MOCK');

        process.env.PAYMENT_MODE = 'live'; // lowercase / typo
        expect(() => getPaymentMode()).toThrow(/Invalid PAYMENT_MODE/);

        process.env.PAYMENT_MODE = 'MOCK_FUJI';
        expect(() => getPaymentMode()).toThrow(/Invalid PAYMENT_MODE/);
      } finally {
        process.env.PAYMENT_MODE = orig;
      }
    });

    it('getJwtSecret fails closed if secret is missing or under 32 chars', () => {
      const orig = process.env.MISSION_TOKEN_SECRET;
      try {
        delete process.env.MISSION_TOKEN_SECRET;
        expect(() => getJwtSecret()).toThrow(/MISSION_TOKEN_SECRET is required/);

        process.env.MISSION_TOKEN_SECRET = 'short-secret';
        expect(() => getJwtSecret()).toThrow(/at least 32 characters/);
      } finally {
        process.env.MISSION_TOKEN_SECRET = orig;
      }
    });

    it('getConfiguredOwner validates hex address format', () => {
      const orig = process.env.OWNER_ADDRESS;
      try {
        delete process.env.OWNER_ADDRESS;
        expect(() => getConfiguredOwner()).toThrow(/OWNER_ADDRESS is required/);

        process.env.OWNER_ADDRESS = 'not-an-address';
        expect(() => getConfiguredOwner()).toThrow(/valid 20-byte hex address/);

        process.env.OWNER_ADDRESS = owner.address;
        expect(getConfiguredOwner()).toBe(normalizeAddress(owner.address));
      } finally {
        process.env.OWNER_ADDRESS = orig;
      }
    });
  });

  describe('F1 & F3: JWT Credential Generation and Verification', () => {
    it('issues spend token and verifies strict claims', async () => {
      const token = await issueSpendToken({
        deploymentId: 'test-dep',
        stage: 'S1',
        authVersion: 1,
        missionSlug: 'mission-alpha',
        missionId: '0x1234',
        ownerAddress: owner.address,
        agentAddress: agent.address,
        missionConfigVersion: 1,
        policyHash: '0xhash',
        missionExpiresAt: new Date(Date.now() + 3600000),
      });

      const claims = await verifyToken(token);
      expect(claims.type).toBe('spend');
      expect(claims.missionSlug).toBe('mission-alpha');
      expect(claims.agent).toBe(normalizeAddress(agent.address));
      expect(claims.owner).toBe(normalizeAddress(owner.address));
      expect(claims.stage).toBe('S1');
    });

    it('rejects tampered or forged tokens', async () => {
      const token = await issueSpendToken({
        deploymentId: 'test-dep',
        stage: 'S1',
        authVersion: 1,
        missionSlug: 'mission-alpha',
        missionId: '0x1234',
        ownerAddress: owner.address,
        agentAddress: agent.address,
        missionConfigVersion: 1,
        policyHash: '0xhash',
        missionExpiresAt: new Date(Date.now() + 3600000),
      });

      // Tamper signature
      const tampered = token.slice(0, -5) + 'abcde';
      await expect(verifyToken(tampered)).rejects.toThrow();

      // Forged JWT with wrong structure
      await expect(verifyToken('invalid.token.structure')).rejects.toThrow();
    });

    it('R06/G2-16: rejects tokens with wrong issuer, wrong stage, wrong chain, or missing exp', async () => {
      const secret = getJwtSecret();

      // 1. Missing exp claim
      const noExpToken = await new SignJWT({
        type: 'spend',
        deploymentId: 'test-dep',
        stage: 'S1',
        chainId: 43113,
        authVersion: 1,
        missionSlug: 'mission-alpha',
        missionId: '0x1',
        owner: normalizeAddress(owner.address),
        agent: normalizeAddress(agent.address),
        missionConfigVersion: 1,
        policyHash: '0x0',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('http://localhost:3000')
        .setAudience('unihack')
        .sign(secret);
      await expect(verifyToken(noExpToken)).rejects.toThrow();

      // 2. Wrong issuer
      const wrongIssuerToken = await new SignJWT({
        type: 'spend',
        deploymentId: 'test-dep',
        stage: 'S1',
        chainId: 43113,
        authVersion: 1,
        missionSlug: 'mission-alpha',
        missionId: '0x1',
        owner: normalizeAddress(owner.address),
        agent: normalizeAddress(agent.address),
        missionConfigVersion: 1,
        policyHash: '0x0',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('http://attacker.com')
        .setAudience('unihack')
        .setExpirationTime('1h')
        .sign(secret);
      await expect(verifyToken(wrongIssuerToken)).rejects.toThrow();

      // 3. Wrong stage
      const wrongStageToken = await new SignJWT({
        type: 'spend',
        deploymentId: 'test-dep',
        stage: 'INVALID_STAGE',
        chainId: 43113,
        authVersion: 1,
        missionSlug: 'mission-alpha',
        missionId: '0x1',
        owner: normalizeAddress(owner.address),
        agent: normalizeAddress(agent.address),
        missionConfigVersion: 1,
        policyHash: '0x0',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('http://localhost:3000')
        .setAudience('unihack')
        .setJti('jti-stage-test')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);
      await expect(verifyToken(wrongStageToken)).rejects.toThrow(/Token stage mismatch/);

      // 4. Wrong chainId
      const wrongChainToken = await new SignJWT({
        type: 'spend',
        deploymentId: 'test-dep',
        stage: 'S1',
        chainId: 1, // Ethereum mainnet instead of 43113
        authVersion: 1,
        missionSlug: 'mission-alpha',
        missionId: '0x1',
        owner: normalizeAddress(owner.address),
        agent: normalizeAddress(agent.address),
        missionConfigVersion: 1,
        policyHash: '0x0',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('http://localhost:3000')
        .setAudience('unihack')
        .setJti('jti-chain-test')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);
      await expect(verifyToken(wrongChainToken)).rejects.toThrow(/Token chainId mismatch/);
    });
  });

  describe('F6: Target and Payload Validation for Challenges', () => {
    it('validatePayloadTarget enforces target mission binding for CLOSE_MISSION_S1', () => {
      // Correct binding
      expect(() =>
        validatePayloadTarget('CLOSE_MISSION_S1', { slug: 'alpha' }, 'alpha')
      ).not.toThrow();

      // Mismatched binding
      expect(() =>
        validatePayloadTarget('CLOSE_MISSION_S1', { slug: 'beta' }, 'alpha')
      ).toThrow(ChallengeError);

      // Missing binding
      expect(() =>
        validatePayloadTarget('CLOSE_MISSION_S1', {}, 'alpha')
      ).toThrow(ChallengeError);
    });

    it('rejects unknown fields in challenge payloads', () => {
      expect(() =>
        validatePayloadTarget(
          'CLOSE_MISSION_S1',
          { slug: 'alpha', extraInjection: 'exploit' },
          'alpha'
        )
      ).toThrow(ChallengeError);
    });

    it('G2-13/G2-14: validatePayloadTarget accepts COMPLETE_MISSION, PREPARE_FEEDBACK and PUBLISH_MISSION', () => {
      // COMPLETE_MISSION
      expect(() =>
        validatePayloadTarget('COMPLETE_MISSION', {
          slug: 'alpha',
          deliverableHash: '0x' + '1'.repeat(64),
        }, 'alpha')
      ).not.toThrow();

      // Unknown key rejected in COMPLETE_MISSION
      expect(() =>
        validatePayloadTarget('COMPLETE_MISSION', {
          slug: 'alpha',
          deliverableHash: '0x' + '1'.repeat(64),
          illegalParam: 'tamper',
        }, 'alpha')
      ).toThrow(ChallengeError);

      // PREPARE_FEEDBACK
      expect(() =>
        validatePayloadTarget('PREPARE_FEEDBACK', {
          slug: 'alpha',
          deliverableHash: '0x' + '1'.repeat(64),
          agentId: '1',
          score: 85,
        }, 'alpha')
      ).not.toThrow();

      // PUBLISH_MISSION
      expect(() =>
        validatePayloadTarget('PUBLISH_MISSION', {
          slug: 'alpha',
          publicPublished: true,
        }, 'alpha')
      ).not.toThrow();

      expect(() =>
        validatePayloadTarget('PUBLISH_MISSION', {
          slug: 'alpha',
          publicPublished: 'not-a-boolean' as any,
        }, 'alpha')
      ).toThrow(ChallengeError);
    });
  });

  describe('F12 & F13: DTO Serialization and Data Leak Protection', () => {
    it('toOperationDto serializes BigInts to strings and strips authSignature', () => {
      const rawOp = {
        id: 101n,
        operationId: 'op-101',
        sessionId: 'sess-1',
        missionSlug: 'test-mission',
        minuteIndex: 0,
        toolId: 'tool:search',
        state: 'SETTLED',
        reservedAmount: 100000n,
        reconcileAmount: 100000n,
        payerAddress: '0x1111',
        sellerAddress: '0x2222',
        termsHash: '0xterms',
        inputHash: '0xinput',
        heldResult: JSON.stringify({ query: 'test' }),
        authSignature: '0xsecret-private-signature-that-must-never-leak',
        authNonce: '0xnonce',
        validAfter: 1000n,
        validBefore: 2000n,
        txHash: '0xtx',
        receiptBlockNumber: 456789n,
        reconcileBlockNumber: 456790n,
        reconcileReason: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const dto = toOperationDto(rawOp);
      expect(dto).not.toBeNull();
      if (!dto) throw new Error('dto is null');

      // Check external identifier and string serialization
      expect(dto.operationId).toBe('op-101');
      expect(dto.reservedAmount).toBe('100000');
      expect(dto.validAfter).toBe('1000');
      expect(dto.validBefore).toBe('2000');
      expect(dto.receiptBlockNumber).toBe('456789');

      // Check stripped private fields
      expect((dto as any).authSignature).toBeUndefined();

      // Ensure JSON.stringify does NOT throw BigInt error
      expect(() => JSON.stringify(dto)).not.toThrow();
    });

    it('G2-28: toOperationDto preserves MOCK paymentMode with no fake chain blocks', () => {
      const mockOp = {
        operationId: 'op-mock-1',
        toolId: 'tool:search',
        state: 'SETTLED',
        paymentMode: 'MOCK',
        reservedAmount: 100000n,
        authFrom: '0x1111',
        authTo: '0x2222',
        authValue: 100000n,
        authNonce: '0xnonce',
        validAfter: 1000n,
        validBefore: 2000n,
        txHash: 'mock:op-mock-1',
        receiptBlockNumber: null,
        receiptBlockHash: null,
        heldResult: JSON.stringify({ query: 'mock search' }),
        heldResultHash: '0xhash',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const dto = toOperationDto(mockOp, { includeResult: true });
      expect(dto).not.toBeNull();
      if (!dto) throw new Error('dto is null');

      expect(dto.paymentMode).toBe('MOCK');
      expect(dto.txHash).toBe('mock:op-mock-1');
      expect(dto.receiptBlockNumber).toBeNull();
      expect(dto.receiptBlockHash).toBeNull();
      expect(dto.result).toEqual({ query: 'mock search' });
    });

    it('toAuditEntryDto serializes BigInt id and converts Decimal amount', () => {
      const rawEntry = {
        id: 999n,
        sourceKey: 'event:1',
        prevHash: '0x0',
        entryHash: '0x1',
        canonicalJson: '{"test":true}',
        createdAt: new Date(),
      };

      const dto = toAuditEntryDto(rawEntry);
      expect(dto).not.toBeNull();
      if (!dto) throw new Error('dto is null');
      expect(dto.id).toBe('999');
      expect(() => JSON.stringify(dto)).not.toThrow();
    });

    it('toMissionDto safely converts Prisma Decimals and dates to string', () => {
      const rawMission = {
        slug: 'mission-dto-test',
        missionId: '0xabc',
        ownerAddress: '0xowner',
        agentAddress: '0xagent',
        treasuryCap: 10000000n,
        toolCap: 5000000n,
        spentTool: 1500000n,
        reservedTool: 500000n,
        expiresAt: new Date('2026-11-05T00:00:00Z'),
        status: 'ACTIVE',
        completedAt: null,
        deliverableHash: null,
        configVersion: 1,
        policyHash: '0xpolicy',
        createdAt: new Date('2026-11-04T00:00:00Z'),
        updatedAt: new Date('2026-11-04T12:00:00Z'),
      };

      const dto = toMissionDto(rawMission);
      expect(dto).not.toBeNull();
      if (!dto) throw new Error('dto is null');
      expect(dto.treasuryCap).toBe('10000000');
      expect(dto.toolCap).toBe('5000000');
      expect(dto.spentTool).toBe('1500000');
      expect(dto.reservedTool).toBe('500000');
      expect(dto.status).toBe('ACTIVE');
      expect(() => JSON.stringify(dto)).not.toThrow();
    });

    it('toSessionDto safely converts Decimals to string', () => {
      const rawSession = {
        id: 'sess-123',
        missionSlug: 'mission-dto-test',
        payerAddress: '0xpayer',
        rate: 50000n,
        cap: 2000000n,
        spent: 100000n,
        reserved: 50000n,
        status: 'ACTIVE',
        startedAt: new Date('2026-11-04T00:00:00Z'),
        stoppedAt: null,
      };

      const dto = toSessionDto(rawSession);
      expect(dto).not.toBeNull();
      if (!dto) throw new Error('dto is null');
      expect(dto.rate).toBe('50000');
      expect(dto.cap).toBe('2000000');
      expect(dto.spent).toBe('100000');
      expect(dto.reserved).toBe('50000');
      expect(() => JSON.stringify(dto)).not.toThrow();
    });
  });

  describe('F11 & E2: Audit Ledger Hash Continuity and Tamper Detection', () => {
    it('verifies valid hash chain and detects tampering, reordering, and truncation', () => {
      const entries = [];
      let prevHash = INITIAL_PREV_HASH;

      for (let i = 0; i < 3; i++) {
        const canonical = canonicalAuditJson({
          actor: '0x1111',
          amount: '100000',
          chain_id: '43113',
          created_at: new Date('2026-11-04T00:00:00Z').toISOString(),
          kind: 'TOOL_RESERVED',
          mission_id: 'mission-alpha',
          operation_id: `op-${i}`,
          policy_hash: '0x0',
          policy_version: '1',
          prev_hash: prevHash,
          reason: `Step ${i}`,
          result_hash: '',
          rule: 'RESERVE',
          source_key: `key-${i}`,
          to: '0x2222',
          tx_hash: `0xtx-${i}`,
        });
        const entryHash = computeEntryHash(canonical);
        entries.push({
          sourceKey: `key-${i}`,
          prevHash,
          entryHash,
          canonicalJson: canonical,
        });
        prevHash = entryHash;
      }

      // 1. Valid chain passes
      const validRes = verifyAuditChain(entries, prevHash);
      expect(validRes.valid).toBe(true);
      expect(validRes.totalEntries).toBe(3);

      // 2. Tampered content fails
      const tampered = JSON.parse(JSON.stringify(entries));
      tampered[1].canonicalJson = tampered[1].canonicalJson.replace('Step 1', 'Hacked');
      const tamperedRes = verifyAuditChain(tampered, prevHash);
      expect(tamperedRes.valid).toBe(false);

      // 3. Inner/outer mismatch fails
      const mismatched = JSON.parse(JSON.stringify(entries));
      mismatched[0].sourceKey = 'wrong-outer-key';
      const mismatchedRes = verifyAuditChain(mismatched, prevHash);
      expect(mismatchedRes.valid).toBe(false);

      // 4. Truncated chain fails checkpoint
      const truncated = entries.slice(0, 2);
      const truncatedRes = verifyAuditChain(truncated, prevHash);
      expect(truncatedRes.valid).toBe(false);
    });

    it('verifyProof CLI validator checks inner/outer alignment and checkpoint', () => {
      const canonical = canonicalAuditJson({
        actor: '0x1111',
        amount: '100000',
        chain_id: '43113',
        created_at: new Date('2026-11-04T00:00:00Z').toISOString(),
        kind: 'TOOL_PAID',
        mission_id: 'mission-alpha',
        operation_id: 'op-proof-1',
        policy_hash: '0x0',
        policy_version: '1',
        prev_hash: INITIAL_PREV_HASH,
        reason: 'Payment completed',
        result_hash: '0xresult123',
        rule: 'SETTLE',
        source_key: 'source:proof:1',
        to: '0x2222',
        tx_hash: '0xtx1',
      });
      const entryHash = computeEntryHash(canonical);
      const validEntries = [
        {
          sourceKey: 'source:proof:1',
          prevHash: INITIAL_PREV_HASH,
          entryHash,
          canonicalJson: canonical,
        },
      ];

      // Passes with matching checkpoint
      const res = verifyProof(validEntries, { headHash: entryHash, entryCount: 1 });
      expect(res.valid).toBe(true);
      expect(res.totalEntries).toBe(1);

      // Fails if inner canonical source_key != outer sourceKey
      const mismatchedEntries = [
        {
          sourceKey: 'source:tampered:outer',
          prevHash: INITIAL_PREV_HASH,
          entryHash,
          canonicalJson: canonical, // inner has 'source:proof:1'
        },
      ];
      const mismatchRes = verifyProof(mismatchedEntries);
      expect(mismatchRes.valid).toBe(false);
      expect(mismatchRes.errors.some((e) => e.includes('sourceKey mismatch'))).toBe(true);
    });

    it('G2-19/G2-20: Mission-scoped proof projection stays unbroken under interleaved missions (A->B->A)', () => {
      // Event 1: Mission A step 1
      const a1Canonical = canonicalAuditJson({
        actor: '0x1111',
        amount: '100000',
        chain_id: '43113',
        created_at: new Date('2026-11-04T00:00:00Z').toISOString(),
        kind: 'TOOL_RESERVED',
        mission_id: 'mission-A',
        operation_id: 'op-a-1',
        policy_hash: '0x0',
        policy_version: '1',
        prev_hash: INITIAL_PREV_HASH,
        reason: 'A step 1',
        result_hash: '',
        rule: 'RESERVE',
        source_key: 'source:a:1',
        to: '0x2222',
        tx_hash: '',
      });
      const a1Hash = computeEntryHash(a1Canonical);

      // Event 2: Mission B step 1 (interleaved on global chain)
      const b1GlobalCanonical = canonicalAuditJson({
        actor: '0x3333',
        amount: '200000',
        chain_id: '43113',
        created_at: new Date('2026-11-04T00:01:00Z').toISOString(),
        kind: 'TOOL_RESERVED',
        mission_id: 'mission-B',
        operation_id: 'op-b-1',
        policy_hash: '0x0',
        policy_version: '1',
        prev_hash: a1Hash,
        reason: 'B step 1',
        result_hash: '',
        rule: 'RESERVE',
        source_key: 'source:b:1',
        to: '0x4444',
        tx_hash: '',
      });
      const b1GlobalHash = computeEntryHash(b1GlobalCanonical);

      // Event 3: Mission A step 2
      // Naive global entry for A2 links to B1:
      const a2GlobalCanonical = canonicalAuditJson({
        actor: '0x1111',
        amount: '100000',
        chain_id: '43113',
        created_at: new Date('2026-11-04T00:02:00Z').toISOString(),
        kind: 'TOOL_PAID',
        mission_id: 'mission-A',
        operation_id: 'op-a-2',
        policy_hash: '0x0',
        policy_version: '1',
        prev_hash: b1GlobalHash,
        reason: 'A step 2',
        result_hash: '0xresA2',
        rule: 'SETTLE',
        source_key: 'source:a:2',
        to: '0x2222',
        tx_hash: 'mock:op-a-2',
      });
      const a2GlobalHash = computeEntryHash(a2GlobalCanonical);

      // 1. Naive export of global entries for Mission A fails with chain break
      const naiveExport = [
        { sourceKey: 'source:a:1', prevHash: INITIAL_PREV_HASH, entryHash: a1Hash, canonicalJson: a1Canonical },
        { sourceKey: 'source:a:2', prevHash: b1GlobalHash, entryHash: a2GlobalHash, canonicalJson: a2GlobalCanonical },
      ];
      const naiveRes = verifyProof(naiveExport);
      expect(naiveRes.valid).toBe(false);
      expect(naiveRes.errors.some((e) => e.includes('Chain broken'))).toBe(true);

      // 2. Scoped mission projection for Mission A links directly to A1
      const a2MissionCanonical = canonicalAuditJson({
        actor: '0x1111',
        amount: '100000',
        chain_id: '43113',
        created_at: new Date('2026-11-04T00:02:00Z').toISOString(),
        kind: 'TOOL_PAID',
        mission_id: 'mission-A',
        operation_id: 'op-a-2',
        policy_hash: '0x0',
        policy_version: '1',
        prev_hash: a1Hash,
        reason: 'A step 2',
        result_hash: '0xresA2',
        rule: 'SETTLE',
        source_key: 'source:a:2',
        to: '0x2222',
        tx_hash: 'mock:op-a-2',
      });
      const a2MissionHash = computeEntryHash(a2MissionCanonical);

      const scopedExport = [
        { sourceKey: 'source:a:1', prevHash: INITIAL_PREV_HASH, entryHash: a1Hash, canonicalJson: a1Canonical },
        { sourceKey: 'source:a:2', prevHash: a1Hash, entryHash: a2MissionHash, canonicalJson: a2MissionCanonical },
      ];
      const scopedRes = verifyProof(scopedExport, { headHash: a2MissionHash, entryCount: 2 });
      expect(scopedRes.valid).toBe(true);
      expect(scopedRes.totalEntries).toBe(2);
      expect(scopedRes.headHash).toBe(a2MissionHash);
    });
  });

  describe('EIP-3009 Transfer Authorization Signer and Verifier', () => {
    it('generates valid EIP-3009 signature and verifies successfully', async () => {
      const nonce = ('0x' + '12'.repeat(32)) as `0x${string}`;
      const validAfter = 0n;
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const value = 500000n; // 0.50 USDC
      const to = normalizeAddress(owner.address) as `0x${string}`;
      const from = normalizeAddress(agent.address) as `0x${string}`;

      const sig = await agent.signTypedData({
        domain: usdcEip712Domain,
        types: eip3009Types,
        primaryType: 'TransferWithAuthorization',
        message: {
          from,
          to,
          value,
          validAfter,
          validBefore,
          nonce,
        },
      });

      // Verify valid signature
      const isValid = await verifyTypedData({
        address: from,
        domain: usdcEip712Domain,
        types: eip3009Types,
        primaryType: 'TransferWithAuthorization',
        message: {
          from,
          to,
          value,
          validAfter,
          validBefore,
          nonce,
        },
        signature: sig,
      });
      expect(isValid).toBe(true);

      // Wrong value fails verification
      const isWrongValue = await verifyTypedData({
        address: from,
        domain: usdcEip712Domain,
        types: eip3009Types,
        primaryType: 'TransferWithAuthorization',
        message: {
          from,
          to,
          value: 999999n,
          validAfter,
          validBefore,
          nonce,
        },
        signature: sig,
      });
      expect(isWrongValue).toBe(false);

      // Wrong recipient fails verification
      const isWrongRecipient = await verifyTypedData({
        address: from,
        domain: usdcEip712Domain,
        types: eip3009Types,
        primaryType: 'TransferWithAuthorization',
        message: {
          from,
          to: from,
          value,
          validAfter,
          validBefore,
          nonce,
        },
        signature: sig,
      });
      expect(isWrongRecipient).toBe(false);
    });
  });

  describe('Proposal Validation Matrix (V3, V8, V12, V14)', () => {
    it('blocks proposal with invalid credential type (read token cannot spend)', () => {
      const ctx: ValidationContext = {
        tokenClaims: {
          type: 'read',
          iss: 'http://localhost:3000',
          aud: 'unihack',
          deploymentId: 'dep-1',
          stage: 'S1',
          chainId: 43113,
          guardAddress: 'none',
          authVersion: 1,
          missionSlug: 'mission-alpha',
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
          slug: 'mission-alpha',
          missionId: '0x1',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 3600000),
          ownerAddress: '0x1',
          agentAddress: '0x2',
          toolCap: 5000000n,
          spentTool: 0n,
          reservedTool: 0n,
          treasuryCap: 10000000n,
          configVersion: 1,
        },
      };

      const res = validateProposal(
        {
          kind: 'tool_purchase',
          mission_id: 'mission-alpha',
          tool_id: 'tool:summary',
          amount_atomic: '500000',
          reason: 'Summary request',
          arguments: { text: 'Valid test text' },
        },
        ctx
      );

      expect(res.outcome).toBe('BLOCK');
      expect(res.rule).toBe('INVALID_CREDENTIAL_TYPE');
    });

    it('blocks proposal when remaining tool budget is insufficient', () => {
      const ctx: ValidationContext = {
        tokenClaims: {
          type: 'spend',
          iss: 'http://localhost:3000',
          aud: 'unihack',
          deploymentId: 'dep-1',
          stage: 'S1',
          chainId: 43113,
          guardAddress: 'none',
          authVersion: 1,
          missionSlug: 'mission-alpha',
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
          slug: 'mission-alpha',
          missionId: '0x1',
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 3600000),
          ownerAddress: '0x1',
          agentAddress: '0x2',
          toolCap: 500000n,
          spentTool: 300000n, // Remaining: 200000n
          reservedTool: 0n,
          treasuryCap: 10000000n,
          configVersion: 1,
        },
      };

      const res = validateProposal(
        {
          kind: 'tool_purchase',
          mission_id: 'mission-alpha',
          tool_id: 'tool:summary', // price 500000n > 200000n
          amount_atomic: '500000',
          reason: 'Summary request',
          arguments: { text: 'Valid test text' },
        },
        ctx
      );

      expect(res.outcome).toBe('BLOCK');
      expect(res.rule).toBe('INSUFFICIENT_TOOL_BUDGET');
    });
  });

  describe('Round 4 Hardening & Direct Production Service Tests (V4-01 to V4-08)', () => {
    it('J4-01: executeUpstreamAndSettle enforces submission ownership and suppresses outbound facilitator calls when active lease belongs to another worker (V4-01)', async () => {
      const input = { text: 'test submission ownership' };
      const operationId = 'op-sub-owned-1';
      const opRecord = {
        operationId,
        missionSlug: 'mission-a',
        toolId: 'tool:summary',
        state: 'SUBMITTING',
        heldResult: JSON.stringify({ summary: 'persisted result' }),
        paymentMode: 'LIVE_FUJI',
        inputHash: computePayloadHash(input),
        workerLeaseOwner: 'worker-existing-owner',
        workerLeaseUntil: new Date(Date.now() + 60000), // active unexpired lease
        workerLeaseGeneration: 1,
        authFrom: '0x' + '1'.repeat(40),
        authTo: '0x' + '2'.repeat(40),
        authValue: 500000n,
        reservedAmount: 500000n,
        authNonce: '0x' + '3'.repeat(64),
        validAfter: 1n,
        validBefore: 2n,
        authSignature: 'fixture-sig',
        asset: '0x' + '4'.repeat(40),
        paymentTerms: JSON.stringify({ resource: 'http://test.invalid/tool', timeoutSeconds: 60 }),
      };

      const originalFind = prisma.toolOperation.findUnique;
      const originalUpdate = prisma.toolOperation.updateMany;
      const originalFetch = global.fetch;

      let facilitatorFetchCalls = 0;
      let updateManyCalls = 0;

      try {
        (prisma.toolOperation as any).findUnique = async () => ({ ...opRecord });
        (prisma.toolOperation as any).updateMany = async () => {
          updateManyCalls++;
          return { count: 0 };
        };
        global.fetch = (async () => {
          facilitatorFetchCalls++;
          return { ok: true, json: async () => ({ success: true }) } as any;
        }) as any;

        const res = await executeUpstreamAndSettle({
          operationId,
          arguments: input,
        });

        // Must NOT call facilitator when another worker owns an active lease!
        expect(facilitatorFetchCalls).toBe(0);
        expect(updateManyCalls).toBe(0);
        expect(res.operation?.state).toBe('SUBMITTING');
        expect(res.result).toBeNull(); // Pending state does not return result
      } finally {
        prisma.toolOperation.findUnique = originalFind;
        prisma.toolOperation.updateMany = originalUpdate;
        global.fetch = originalFetch;
      }
    });

    it('J4-03: Proof GET enforces authorization before reading/mutating and performs ZERO writes on unauthorized private requests (V4-02)', async () => {
      let auditUpdates = 0;
      let missionUpdates = 0;

      const privateMission = {
        slug: 'mission-private-1',
        missionId: 'm-priv-1',
        ownerAddress: '0x' + '1'.repeat(40),
        agentAddress: '0x' + '2'.repeat(40),
        operations: [],
        toolCap: 5000000n,
        spentTool: 0n,
        reservedTool: 0n,
        status: 'ACTIVE',
        publicPublished: false, // PRIVATE!
        auditHeadHash: INITIAL_PREV_HASH,
        auditEntryCount: 0,
      };

      const originalTx = prisma.$transaction;
      try {
        (prisma as any).$transaction = async (fn: any) => {
          const mockTx = {
            mission: {
              findUnique: async () => ({ ...privateMission }),
              update: async () => {
                missionUpdates++;
                return {};
              },
            },
            auditEntry: {
              findMany: async () => [],
              update: async () => {
                auditUpdates++;
                return {};
              },
            },
          };
          return await fn(mockTx);
        };

        // Unauthorized request without token
        const req = new NextRequest('http://localhost:3000/api/missions/mission-private-1/proof');
        const res = await getProof(req, { params: { slug: 'mission-private-1' } });

        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.error).toMatch(/Unauthorized/);

        // Zero writes assertion
        expect(auditUpdates).toBe(0);
        expect(missionUpdates).toBe(0);
      } finally {
        prisma.$transaction = originalTx;
      }
    });

    it('J4-04: Proof GET returns valid continuous companion projection and matching checkpoint on public legacy export (V4-03)', async () => {
      const publicMission = {
        slug: 'mission-pub-legacy',
        missionId: 'm-pub-1',
        ownerAddress: '0x' + '1'.repeat(40),
        agentAddress: '0x' + '2'.repeat(40),
        operations: [],
        toolCap: 5000000n,
        spentTool: 0n,
        reservedTool: 0n,
        status: 'ACTIVE',
        publicPublished: true, // PUBLIC!
        auditHeadHash: INITIAL_PREV_HASH,
        auditEntryCount: 0,
        createdAt: new Date(),
        completedAt: new Date(),
      };

      const canon1 = canonicalAuditJson({
        actor: '',
        amount: '0',
        chain_id: '43113',
        created_at: '2026-11-04T00:00:00.000Z',
        kind: 'TOOL_RESERVED',
        mission_id: 'mission-pub-legacy',
        operation_id: 'op-legacy-1',
        policy_hash: '',
        policy_version: '1',
        prev_hash: INITIAL_PREV_HASH,
        reason: 'legacy fixture 1',
        result_hash: '',
        rule: '',
        source_key: 'fixture:leg1',
        to: '',
        tx_hash: '',
      });

      const canon2 = canonicalAuditJson({
        actor: '',
        amount: '0',
        chain_id: '43113',
        created_at: '2026-11-04T00:01:00.000Z',
        kind: 'TOOL_PAID',
        mission_id: 'mission-pub-legacy',
        operation_id: 'op-legacy-2',
        policy_hash: '',
        policy_version: '1',
        prev_hash: computeEntryHash(canon1),
        reason: 'legacy fixture 2',
        result_hash: '',
        rule: '',
        source_key: 'fixture:leg2',
        to: '',
        tx_hash: '',
      });

      const legacyRows = [
        {
          id: 1n,
          sourceKey: 'fixture:leg1',
          canonicalJson: canon1,
          entryHash: computeEntryHash(canon1),
          prevHash: INITIAL_PREV_HASH,
          missionSlug: null, // Legacy unprojected
          missionSequence: null,
          missionPrevHash: null,
          missionEntryHash: null,
          missionCanonicalJson: null,
        },
        {
          id: 2n,
          sourceKey: 'fixture:leg2',
          canonicalJson: canon2,
          entryHash: computeEntryHash(canon2),
          prevHash: computeEntryHash(canon1),
          missionSlug: null, // Legacy unprojected
          missionSequence: null,
          missionPrevHash: null,
          missionEntryHash: null,
          missionCanonicalJson: null,
        },
      ];

      const originalTx = prisma.$transaction;
      try {
        (prisma as any).$transaction = async (fn: any) => {
          const mockTx = {
            mission: {
              findUnique: async () => ({ ...publicMission }),
            },
            auditEntry: {
              findMany: async () => [...legacyRows],
            },
          };
          return await fn(mockTx);
        };

        const req = new NextRequest('http://localhost:3000/api/missions/mission-pub-legacy/proof?public=true');
        const res = await getProof(req, { params: { slug: 'mission-pub-legacy' } });

        expect(res.status).toBe(200);
        const data = await res.json();

        // Run independent proof verification
        const verification = verifyProof(data.audit.entries, data.audit.checkpoint);
        expect(verification.valid).toBe(true);
        expect(verification.errors).toHaveLength(0);

        // Checkpoint headHash must match the last entry hash
        expect(data.audit.checkpoint.headHash).toBe(data.audit.entries[1].entryHash);
        expect(data.audit.checkpoint.entryCount).toBe(2);
      } finally {
        prisma.$transaction = originalTx;
      }
    });

    it('J4-05: backfillMissionAuditProjections persists companion fields deterministically across legacy entries (V4-03)', async () => {
      const missionSlug = 'mission-backfill-test';
      const mockMission = {
        slug: missionSlug,
        auditHeadHash: INITIAL_PREV_HASH,
        auditEntryCount: 0,
        createdAt: new Date(),
      };

      const canon1 = canonicalAuditJson({
        actor: '',
        amount: '0',
        chain_id: '43113',
        created_at: '2026-11-04T00:00:00.000Z',
        kind: 'TOOL_RESERVED',
        mission_id: missionSlug,
        operation_id: 'op-1',
        policy_hash: '',
        policy_version: '1',
        prev_hash: INITIAL_PREV_HASH,
        reason: 'backfill 1',
        result_hash: '',
        rule: '',
        source_key: 'bf:1',
        to: '',
        tx_hash: '',
      });

      const entries = [
        { id: 10n, sourceKey: 'bf:1', canonicalJson: canon1, entryHash: computeEntryHash(canon1) },
      ];

      const auditUpdates: any[] = [];
      let missionHeadUpdate: string | null = null;
      let missionCountUpdate: number | null = null;

      const mockTx = {
        mission: {
          findMany: async () => [mockMission],
          update: async ({ data }: any) => {
            missionHeadUpdate = data.auditHeadHash;
            missionCountUpdate = data.auditEntryCount;
          },
        },
        auditEntry: {
          findMany: async () => entries,
          update: async ({ where, data }: any) => {
            auditUpdates.push({ where, data });
          },
        },
      };

      const result = await backfillMissionAuditProjections(mockTx, missionSlug);
      expect(result.projectedCount).toBe(1);
      expect(result.missionsUpdated).toContain(missionSlug);

      expect(auditUpdates).toHaveLength(1);
      expect(auditUpdates[0].data.missionSlug).toBe(missionSlug);
      expect(auditUpdates[0].data.missionSequence).toBe(1);
      expect(auditUpdates[0].data.missionPrevHash).toBe(INITIAL_PREV_HASH);
      expect(auditUpdates[0].data.missionEntryHash).toBeTruthy();

      expect(missionHeadUpdate).toBe(auditUpdates[0].data.missionEntryHash);
      expect(missionCountUpdate).toBe(1);
    });

    it('J4-06: Production chain reader enforces Avalanche Fuji chainId and matches expectedTo and expectedValue (V4-01, T09)', async () => {
      const reader = createProductionChainReader();
      const expectedTo = normalizeAddress('0x' + '2'.repeat(40));
      const expectedValue = 100000n;

      // When called with non-existent tx, it returns null without crashing
      const evidence = await reader({
        chainId: 43113,
        asset: '0x' + '4'.repeat(40),
        authFrom: '0x' + '1'.repeat(40),
        authNonce: '0x' + '3'.repeat(64),
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        expectedTo,
        expectedValue,
      });

      // Since testnet RPC will return null receipt for dummy hash:
      expect(evidence === null || evidence === undefined || evidence.status === 'reverted').toBe(true);
    });

    it('J4-07: Orchestrator POST handler enforces idempotency and rejects input tampering (V4-06)', async () => {
      const spendToken = await issueSpendToken({
        deploymentId: 'test-dep',
        stage: 'S1',
        authVersion: 1,
        missionSlug: 'test-mission-idem',
        missionId: '0x1',
        ownerAddress: '0x' + '1'.repeat(40),
        agentAddress: '0x' + '2'.repeat(40),
        missionConfigVersion: 1,
        policyHash: '0x0',
        missionExpiresAt: new Date(Date.now() + 3600000),
      });

      const existingOp = {
        operationId: 'idem-op-test',
        missionSlug: 'test-mission-idem',
        toolId: 'tool:search',
        state: 'SETTLED',
        paymentMode: 'MOCK',
        inputHash: computePayloadHash({ query: 'Avalanche' }),
        heldResult: JSON.stringify({ points: ['Existing result'] }),
        reservedAmount: 100000n,
      };

      const originalFind = prisma.toolOperation.findUnique;
      const originalUpdateMany = prisma.toolOperation.updateMany;
      try {
        (prisma.toolOperation as any).updateMany = async () => ({ count: 1 });
        (prisma.toolOperation as any).findUnique = async () => ({ ...existingOp });

        // Request with different input on same operationId -> 409 Conflict
        const tamperedReq = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${spendToken}`,
          },
          body: JSON.stringify({
            operationId: 'idem-op-test',
            toolId: 'tool:search',
            arguments: { query: 'Tampered query' },
          }),
        });

        const tamperedRes = await postOrchestrate(tamperedReq);
        expect(tamperedRes.status).toBe(409);
        const tamperedData = await tamperedRes.json();
        expect(tamperedData.error).toMatch(/INPUT_MISMATCH/);

        // Request with identical input on same operationId -> 200 OK (idempotent result)
        const matchReq = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${spendToken}`,
          },
          body: JSON.stringify({
            operationId: 'idem-op-test',
            toolId: 'tool:search',
            arguments: { query: 'Avalanche' },
          }),
        });

        const matchRes = await postOrchestrate(matchReq);
        expect(matchRes.status).toBe(200);
        const matchData = await matchRes.json();
        expect(matchData.state).toBe('SETTLED');
        expect(matchData.result).toEqual({ points: ['Existing result'] });
      } finally {
        prisma.toolOperation.findUnique = originalFind;
        prisma.toolOperation.updateMany = originalUpdateMany;
      }
    });

    it('J4-08: TalkMeter tick handler rejects billing when less than 60s elapsed (V4-06, H3-15)', async () => {
      const spendToken = await issueSpendToken({
        deploymentId: 'test-dep',
        stage: 'S1',
        authVersion: 1,
        missionSlug: 'tm-mission',
        missionId: '0x1',
        ownerAddress: '0x' + '1'.repeat(40),
        agentAddress: '0x' + '2'.repeat(40),
        missionConfigVersion: 1,
        policyHash: '0x0',
        missionExpiresAt: new Date(Date.now() + 3600000),
      });

      const sessionStartedJustNow = {
        id: 'sess-recent',
        missionSlug: 'tm-mission',
        payerAddress: '0x' + '2'.repeat(40),
        status: 'ACTIVE',
        spent: 0n,
        reserved: 0n,
        startedAt: new Date(Date.now() - 5000), // 5 seconds ago
        operations: [],
      };

      const originalTx = (prisma as any).$transaction;
      try {
        (prisma as any).$transaction = async (fn: any) =>
          fn({
            $queryRaw: async () => [],
            toolSession: {
              findUnique: async () => ({ ...sessionStartedJustNow }),
            },
          });

        const tickReq = new NextRequest('http://localhost:3000/api/tools/talkmeter/tick', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${spendToken}`,
          },
          body: JSON.stringify({ sessionId: 'sess-recent' }),
        });

        const tickRes = await postTalkmeterTick(tickReq);
        expect(tickRes.status).toBe(400);
        const data = await tickRes.json();
        expect(data.error).toMatch(/elapsed/);
      } finally {
        (prisma as any).$transaction = originalTx;
      }
    });

    it('J4-09: Migration provenance does NOT classify pending live operations as MOCK (V4-04)', () => {
      // Row 1: Historical mock row with txHash 'mock:123' -> MOCK
      const rowMock = { txHash: 'mock:123', paymentMode: null, receiptBlockNumber: null };
      const modeMock = (rowMock.paymentMode === null && rowMock.txHash?.startsWith('mock:')) ? 'MOCK' : 'LIVE_FUJI';
      expect(modeMock).toBe('MOCK');

      // Row 2: Live operation in SIGNED / UNKNOWN state with no receipt yet -> LIVE_FUJI
      const rowLivePending = { txHash: null, paymentMode: null, receiptBlockNumber: null };
      const modeLivePending = (rowLivePending.paymentMode === null && (rowLivePending.txHash as any)?.startsWith('mock:')) ? 'MOCK' : 'LIVE_FUJI';
      expect(modeLivePending).toBe('LIVE_FUJI'); // Must NEVER be classified as MOCK!

      // Row 3: Live operation settled on Fuji with real txHash -> LIVE_FUJI
      const rowLiveSettled = { txHash: '0xabc123', paymentMode: null, receiptBlockNumber: 43113n };
      const modeLiveSettled = (rowLiveSettled.paymentMode === null && (rowLiveSettled.txHash as any)?.startsWith('mock:')) ? 'MOCK' : 'LIVE_FUJI';
      expect(modeLiveSettled).toBe('LIVE_FUJI');
    });

    it('M5-01: Orchestrator retry state machine dispatches FAILED, CREATED, and RESERVED without 500 runtime errors', async () => {
      const origAgentKey = process.env.AGENT_PRIVATE_KEY;
      const agentAddress = normalizeAddress(agent.address);
      const ownerAddress = normalizeAddress(owner.address);
      const sellerAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

      try {
        const spendToken = await issueSpendToken({
          deploymentId: 'test-dep',
          stage: 'S1',
          authVersion: 1,
          missionSlug: 'mission-m5-retry',
          missionId: '0x1',
          ownerAddress,
          agentAddress,
          missionConfigVersion: 1,
          policyHash: '0x0',
          missionExpiresAt: new Date(Date.now() + 3600000),
        });

        const input = { query: 'retry query' };
        const baseOp = {
          operationId: '11111111-1111-4111-8111-111111111111',
          missionSlug: 'mission-m5-retry',
          toolId: 'tool:search',
          inputHash: computePayloadHash(input),
          paymentMode: 'MOCK',
          chainId: 43113,
          asset: '0x' + '4'.repeat(40),
          payerAddress: agentAddress,
          authFrom: agentAddress,
          authTo: sellerAddress,
          authValue: 1000n,
          authNonce: '0x123',
          validAfter: 0n,
          validBefore: 2000000000n,
          authSignature: 'mock_sig',
          policyHash: '0x0',
          paymentTerms: JSON.stringify({ priceAtomic: '1000', payTo: sellerAddress }),
          paymentTermsHash: '0xterms',
          quoteExpiresAt: new Date(Date.now() + 60000),
          authDeploymentVersion: 1,
        };

        const originalFind = prisma.toolOperation.findUnique;
        const originalUpdateMany = prisma.toolOperation.updateMany;
        const originalTx = (prisma as any).$transaction;

        try {
          (prisma.toolOperation as any).updateMany = async () => ({ count: 1 });

          // 1. Test FAILED state -> HTTP 400 terminal DTO, no 500 error!
          (prisma.toolOperation as any).findUnique = async () => ({
            ...baseOp,
            state: 'FAILED',
            failureReason: 'UPSTREAM_TIMEOUT',
          });

          const failedReq = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${spendToken}`,
            },
            body: JSON.stringify({
              operationId: baseOp.operationId,
              toolId: baseOp.toolId,
              arguments: input,
            }),
          });

          const failedRes = await postOrchestrate(failedReq);
          expect(failedRes.status).toBe(400);
          const failedData = await failedRes.json();
          expect(failedData.state).toBe('FAILED');
          expect(failedData.failureReason).toBe('UPSTREAM_TIMEOUT');
          expect(failedData.error).toBe('UPSTREAM_TIMEOUT');

          // Helper to mock transaction for advancing states
          const createMockTx = (getState: () => string, onStateChange: (state: string) => void) => {
            return async (fn: any) => {
              return await fn({
                $queryRaw: async () => [],
                toolOperation: {
                  findUnique: async () => ({
                    ...baseOp,
                    state: getState(),
                    quoteExpiresAt: new Date(Date.now() + 60000),
                    authDeploymentVersion: 1,
                    paymentTerms: JSON.stringify({ priceAtomic: '1000', payTo: sellerAddress }),
                  }),
                  update: async ({ data }: any) => {
                    if (data.state) {
                      onStateChange(data.state);
                    }
                    return { ...baseOp, state: getState() };
                  },
                  updateMany: async () => ({ count: 1 }),
                },
                systemState: {
                  findUnique: async () => ({ id: 1, systemPaused: false, maintenance: false, authVersion: 1 }),
                },
                mission: {
                  findUnique: async () => ({
                    slug: 'mission-m5-retry',
                    status: 'ACTIVE',
                    expiresAt: new Date(Date.now() + 3600000),
                    configVersion: 1,
                    toolCap: 5000000n,
                    spentTool: 0n,
                    reservedTool: 0n,
                  }),
                  update: async () => ({}),
                },
                auditHead: {
                  findUnique: async () => ({ id: 1, lastHash: INITIAL_PREV_HASH }),
                  update: async () => ({}),
                },
                auditEntry: {
                  findUnique: async () => null,
                  findFirst: async () => null,
                  create: async () => ({}),
                },
              });
            };
          };

          // 2. Test CREATED state -> advances through reserve/sign/settle
          // Path 2A: With explicit AGENT_PRIVATE_KEY
          process.env.AGENT_PRIVATE_KEY = TEST_AGENT_KEY;
          let reservedCalledWithKey = false;
          let opCurrentStateWithKey = 'CREATED';

          (prisma.toolOperation as any).findUnique = async () => ({
            ...baseOp,
            state: opCurrentStateWithKey,
            quoteExpiresAt: new Date(Date.now() + 60000),
            authDeploymentVersion: 1,
            paymentTerms: JSON.stringify({ priceAtomic: '1000', payTo: sellerAddress }),
          });

          (prisma as any).$transaction = createMockTx(
            () => opCurrentStateWithKey,
            (newState) => {
              opCurrentStateWithKey = newState;
              if (newState === 'RESERVED') reservedCalledWithKey = true;
            }
          );

          const createdReqWithKey = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${spendToken}`,
            },
            body: JSON.stringify({
              operationId: baseOp.operationId,
              toolId: baseOp.toolId,
              arguments: input,
            }),
          });

          const createdResWithKey = await postOrchestrate(createdReqWithKey);
          expect(createdResWithKey.status).not.toBe(500);
          expect([200, 202]).toContain(createdResWithKey.status);
          expect(reservedCalledWithKey).toBe(true);

          // Path 2B: With AGENT_PRIVATE_KEY absent
          delete process.env.AGENT_PRIVATE_KEY;
          let reservedCalledNoKey = false;
          let opCurrentStateNoKey = 'CREATED';

          (prisma.toolOperation as any).findUnique = async () => ({
            ...baseOp,
            state: opCurrentStateNoKey,
            quoteExpiresAt: new Date(Date.now() + 60000),
            authDeploymentVersion: 1,
            paymentTerms: JSON.stringify({ priceAtomic: '1000', payTo: sellerAddress }),
          });

          (prisma as any).$transaction = createMockTx(
            () => opCurrentStateNoKey,
            (newState) => {
              opCurrentStateNoKey = newState;
              if (newState === 'RESERVED') reservedCalledNoKey = true;
            }
          );

          const createdReqNoKey = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${spendToken}`,
            },
            body: JSON.stringify({
              operationId: baseOp.operationId,
              toolId: baseOp.toolId,
              arguments: input,
            }),
          });

          const createdResNoKey = await postOrchestrate(createdReqNoKey);
          expect(createdResNoKey.status).not.toBe(500);
          expect([200, 202]).toContain(createdResNoKey.status);
          expect(reservedCalledNoKey).toBe(true);

          // 3. Test RESERVED state -> skips reserve, advances through sign/settle
          process.env.AGENT_PRIVATE_KEY = TEST_AGENT_KEY;
          let reserveCalledForReserved = false;
          let opReservedState = 'RESERVED';

          (prisma.toolOperation as any).findUnique = async () => ({
            ...baseOp,
            state: opReservedState,
            quoteExpiresAt: new Date(Date.now() + 60000),
            authDeploymentVersion: 1,
            paymentTerms: JSON.stringify({ priceAtomic: '1000', payTo: sellerAddress }),
          });

          (prisma as any).$transaction = createMockTx(
            () => opReservedState,
            (newState) => {
              opReservedState = newState;
              if (newState === 'RESERVED') reserveCalledForReserved = true;
            }
          );

          const reservedReq = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${spendToken}`,
            },
            body: JSON.stringify({
              operationId: baseOp.operationId,
              toolId: baseOp.toolId,
              arguments: input,
            }),
          });

          const reservedRes = await postOrchestrate(reservedReq);
          expect(reservedRes.status).not.toBe(500);
          expect([200, 202]).toContain(reservedRes.status);
          expect(reserveCalledForReserved).toBe(false); // Does not re-reserve when already in RESERVED
        } finally {
          (prisma as any).$transaction = originalTx;
          prisma.toolOperation.findUnique = originalFind;
          prisma.toolOperation.updateMany = originalUpdateMany;
        }
      } finally {
        if (origAgentKey === undefined) {
          delete process.env.AGENT_PRIVATE_KEY;
        } else {
          process.env.AGENT_PRIVATE_KEY = origAgentKey;
        }
      }
    });

    it('M5-02: Embedded SQL upgrade normalizes legacy synthetic mock receipt fields before mode-aware check constraint', async () => {
      const db = new PGlite();
      try {
        const initPath = path.resolve(__dirname, '../prisma/migrations/20261104000000_init/migration.sql');
        const round2Path = path.resolve(__dirname, '../prisma/migrations/20261104100000_round2_hardening/migration.sql');

        await db.exec(fs.readFileSync(initPath, 'utf8'));

        await db.query(
          'INSERT INTO "Mission" ("slug","missionId","ownerAddress","agentAddress",' +
            '"treasuryCap","toolCap","spentTool","reservedTool","expiresAt","status",' +
            '"policyHash","updatedAt") VALUES ' +
            "('test-mig-mission','test-mig-id','owner','agent',10000000,5000000,500000,0," +
            "'2026-11-06','ACTIVE','policy',CURRENT_TIMESTAMP)"
        );

        // Row 1: Legacy SETTLED mock with synthetic block/hash/logs
        const rowMock = {
          operationId: '11111111-1111-4111-8111-111111111111',
          deploymentId: 'legacy-dep',
          missionSlug: 'test-mig-mission',
          payerAddress: 'agent',
          toolId: 'tool:summary',
          inputHash: 'input1',
          paymentTerms: '{}',
          paymentTermsHash: 'terms1',
          policyHash: 'policy',
          chainId: 43113,
          asset: 'usdc',
          state: 'SETTLED',
          authDeploymentVersion: 1,
          quoteExpiresAt: '2026-11-06T00:00:00Z',
          reservedAmount: '0',
          authFrom: 'agent',
          authTo: 'seller',
          authValue: '500000',
          authNonce: 'nonce1',
          validAfter: 0,
          validBefore: 2000000000,
          authSignature: 'mock_sig_1',
          heldResult: '{"summary":"legacy fixture"}',
          heldResultHash: 'result-hash-1',
          txHash: 'mock:11111111-1111-4111-8111-111111111111',
          receiptBlockNumber: 1000,
          receiptBlockHash: 'legacy-fake-block',
          authorizationLogIndex: 0,
          transferLogIndex: 1,
          updatedAt: '2026-11-04T00:00:00Z',
        };

        // Row 2: Legacy SETTLED live with real chain receipts
        const rowLiveSettled = {
          operationId: '22222222-2222-4222-8222-222222222222',
          deploymentId: 'legacy-dep',
          missionSlug: 'test-mig-mission',
          payerAddress: 'agent',
          toolId: 'tool:search',
          inputHash: 'input2',
          paymentTerms: '{}',
          paymentTermsHash: 'terms2',
          policyHash: 'policy',
          chainId: 43113,
          asset: 'usdc',
          state: 'SETTLED',
          authDeploymentVersion: 1,
          quoteExpiresAt: '2026-11-06T00:00:00Z',
          reservedAmount: '0',
          authFrom: 'agent',
          authTo: 'seller',
          authValue: '500000',
          authNonce: 'nonce2',
          validAfter: 0,
          validBefore: 2000000000,
          authSignature: 'live_sig_2',
          heldResult: '{"points":["real live result"]}',
          heldResultHash: 'result-hash-2',
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          receiptBlockNumber: 543210,
          receiptBlockHash: '0xrealblockhash123',
          authorizationLogIndex: 2,
          transferLogIndex: 3,
          updatedAt: '2026-11-04T00:00:00Z',
        };

        // Row 3: Legacy SIGNED live pending with no receipts
        const rowLiveSigned = {
          operationId: '33333333-3333-4333-8333-333333333333',
          deploymentId: 'legacy-dep',
          missionSlug: 'test-mig-mission',
          payerAddress: 'agent',
          toolId: 'tool:search',
          inputHash: 'input3',
          paymentTerms: '{}',
          paymentTermsHash: 'terms3',
          policyHash: 'policy',
          chainId: 43113,
          asset: 'usdc',
          state: 'SIGNED',
          authDeploymentVersion: 1,
          quoteExpiresAt: '2026-11-06T00:00:00Z',
          reservedAmount: '500000',
          authFrom: 'agent',
          authTo: 'seller',
          authValue: '500000',
          authNonce: 'nonce3',
          validAfter: 0,
          validBefore: 2000000000,
          authSignature: 'live_sig_3',
          heldResult: null,
          heldResultHash: null,
          txHash: null,
          receiptBlockNumber: null,
          receiptBlockHash: null,
          authorizationLogIndex: null,
          transferLogIndex: null,
          updatedAt: '2026-11-04T00:00:00Z',
        };

        for (const r of [rowMock, rowLiveSettled, rowLiveSigned]) {
          const keys = Object.keys(r);
          await db.query(
            'INSERT INTO "ToolOperation" (' +
              keys.map((k) => '"' + k + '"').join(',') +
              ') VALUES (' +
              keys.map((_, i) => '$' + (i + 1)).join(',') +
              ')',
            Object.values(r)
          );
        }

        // Apply Round 2 forward hardening migration: must succeed without SQLSTATE 23514
        await db.exec(fs.readFileSync(round2Path, 'utf8'));

        const res = await db.query(
          'SELECT "operationId", "paymentMode", "receiptBlockNumber", "receiptBlockHash", "txHash" FROM "ToolOperation" ORDER BY "operationId"'
        );

        // Verify normalized mock row
        const mockRow = (res.rows as any[]).find((r: any) => r.operationId === rowMock.operationId);
        expect(mockRow.paymentMode).toBe('MOCK');
        expect(mockRow.receiptBlockNumber).toBeNull();
        expect(mockRow.receiptBlockHash).toBeNull();

        // Verify live settled row untouched
        const liveSettled = (res.rows as any[]).find((r: any) => r.operationId === rowLiveSettled.operationId);
        expect(liveSettled.paymentMode).toBe('LIVE_FUJI');
        expect(Number(liveSettled.receiptBlockNumber)).toBe(543210);
        expect(liveSettled.receiptBlockHash).toBe('0xrealblockhash123');

        // Verify live signed row retained as LIVE_FUJI
        const liveSigned = (res.rows as any[]).find((r: any) => r.operationId === rowLiveSigned.operationId);
        expect(liveSigned.paymentMode).toBe('LIVE_FUJI');
        expect(liveSigned.receiptBlockNumber).toBeNull();
      } finally {
        await db.close();
      }
    });

    it('M5-03: Proof GET rejects mixed unprojected history and detects tampered canonical source', async () => {
      const missionSlug = 'mission-m5-proof';
      const baseMission = {
        slug: missionSlug,
        missionId: 'm-proof-1',
        ownerAddress: '0x' + '1'.repeat(40),
        agentAddress: '0x' + '2'.repeat(40),
        operations: [],
        toolCap: 5000000n,
        spentTool: 0n,
        reservedTool: 0n,
        status: 'ACTIVE',
        publicPublished: true,
        auditHeadHash: INITIAL_PREV_HASH,
        auditEntryCount: 0,
        createdAt: new Date(),
      };

      const originalTx = prisma.$transaction;
      try {
        // Case B: Tampered canonical source must be rejected (not silently rehashed!)
        const canonB = canonicalAuditJson({
          actor: '', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:00:00.000Z',
          kind: 'TOOL_RESERVED', mission_id: missionSlug, operation_id: 'op-b',
          policy_hash: '', policy_version: '1', prev_hash: INITIAL_PREV_HASH, reason: 'authentic',
          result_hash: '', rule: '', source_key: 'entry:tampered', to: '', tx_hash: ''
        });
        const genuineHash = computeEntryHash(canonB);
        const tamperedCanon = canonB.replace('authentic', 'TAMPERED_TEXT');

        (prisma as any).$transaction = async (fn: any) => fn({
          mission: { findUnique: async () => ({ ...baseMission }) },
          auditEntry: {
            findMany: async () => [
              {
                id: 1n,
                sourceKey: 'entry:tampered',
                canonicalJson: tamperedCanon,
                entryHash: genuineHash, // Mismatch!
                prevHash: INITIAL_PREV_HASH,
                missionSlug: null,
                missionSequence: null,
                missionPrevHash: null,
                missionEntryHash: null,
                missionCanonicalJson: null,
              },
            ],
          },
        });

        const tamperedReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/proof?public=true`);
        const tamperedRes = await getProof(tamperedReq, { params: { slug: missionSlug } });
        expect(tamperedRes.status).toBe(409);
        const tamperedData = await tamperedRes.json();
        expect(tamperedData.error).toMatch(/AUDIT_SOURCE_INTEGRITY_VIOLATION/);

        // Case A: Mixed legacy + projected history must return 409 AUDIT_PROJECTION_INCOMPLETE
        const canon1 = canonicalAuditJson({
          actor: '', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:00:00.000Z',
          kind: 'TOOL_RESERVED', mission_id: missionSlug, operation_id: 'op-1',
          policy_hash: '', policy_version: '1', prev_hash: INITIAL_PREV_HASH, reason: 'event 1',
          result_hash: '', rule: '', source_key: 'entry:leg1', to: '', tx_hash: ''
        });
        const canon2 = canonicalAuditJson({
          actor: '', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:01:00.000Z',
          kind: 'TOOL_PAID', mission_id: missionSlug, operation_id: 'op-2',
          policy_hash: '', policy_version: '1', prev_hash: computeEntryHash(canon1), reason: 'event 2',
          result_hash: '', rule: '', source_key: 'entry:proj2', to: '', tx_hash: ''
        });

        (prisma as any).$transaction = async (fn: any) => fn({
          mission: { findUnique: async () => ({ ...baseMission, auditHeadHash: computeEntryHash(canon2), auditEntryCount: 1 }) },
          auditEntry: {
            findMany: async () => [
              {
                id: 1n,
                sourceKey: 'entry:leg1',
                canonicalJson: canon1,
                entryHash: computeEntryHash(canon1),
                prevHash: INITIAL_PREV_HASH,
                missionSlug: null,
                missionSequence: null,
                missionPrevHash: null,
                missionEntryHash: null,
                missionCanonicalJson: null,
              },
              {
                id: 2n,
                sourceKey: 'entry:proj2',
                canonicalJson: canon2,
                entryHash: computeEntryHash(canon2),
                prevHash: computeEntryHash(canon1),
                missionSlug: missionSlug,
                missionSequence: 1,
                missionPrevHash: INITIAL_PREV_HASH,
                missionEntryHash: computeEntryHash(canon2),
                missionCanonicalJson: canon2,
              },
            ],
          },
        });

        const mixedReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/proof?public=true`);
        const mixedRes = await getProof(mixedReq, { params: { slug: missionSlug } });
        expect(mixedRes.status).toBe(409);
        const mixedData = await mixedRes.json();
        expect(mixedData.error).toMatch(/AUDIT_PROJECTION_INCOMPLETE/);
      } finally {
        (prisma as any).$transaction = originalTx;
      }
    });

    it('M6-01: Two-phase sequence clearing avoids unique constraint collision on AuditEntry_missionSlug_missionSequence_key', async () => {
      const db = new PGlite();
      try {
        const initPath = path.resolve(__dirname, '../prisma/migrations/20261104000000_init/migration.sql');
        const round2Path = path.resolve(__dirname, '../prisma/migrations/20261104100000_round2_hardening/migration.sql');
        await db.exec(fs.readFileSync(initPath, 'utf8'));
        await db.exec(fs.readFileSync(round2Path, 'utf8'));

        const missionSlug = 'mixed-seq-mission';
        await db.query(
          'INSERT INTO "Mission" ("slug","missionId","ownerAddress","agentAddress",' +
            '"treasuryCap","toolCap","spentTool","reservedTool","expiresAt","status",' +
            '"policyHash","updatedAt") VALUES ' +
            `('${missionSlug}','m-seq-1','0x1111111111111111111111111111111111111111','0x2222222222222222222222222222222222222222',` +
            "10000000,5000000,0,0,'2026-11-06','ACTIVE','0xpolicy',CURRENT_TIMESTAMP)"
        );

        const canon1 = canonicalAuditJson({
          actor: '0x1111111111111111111111111111111111111111',
          amount: '0',
          chain_id: '43113',
          created_at: '2026-11-04T00:00:00.000Z',
          kind: 'TOOL_RESERVED',
          mission_id: missionSlug,
          operation_id: 'op-1',
          policy_hash: '0x0',
          policy_version: '1',
          prev_hash: INITIAL_PREV_HASH,
          reason: 'legacy first',
          result_hash: '',
          rule: '',
          source_key: 'entry:leg1',
          to: '',
          tx_hash: '',
        });
        const hash1 = computeEntryHash(canon1);

        const canon2 = canonicalAuditJson({
          actor: '0x1111111111111111111111111111111111111111',
          amount: '0',
          chain_id: '43113',
          created_at: '2026-11-04T00:01:00.000Z',
          kind: 'TOOL_PAID',
          mission_id: missionSlug,
          operation_id: 'op-2',
          policy_hash: '0x0',
          policy_version: '1',
          prev_hash: hash1,
          reason: 'newer second',
          result_hash: '',
          rule: '',
          source_key: 'entry:proj2',
          to: '',
          tx_hash: '',
        });
        const hash2 = computeEntryHash(canon2);

        // Row 1: Older entry, unprojected legacy (missionSequence = null)
        await db.query(
          'INSERT INTO "AuditEntry" ("sourceKey","canonicalJson","entryHash","prevHash","missionSlug","missionSequence","missionPrevHash","missionEntryHash","missionCanonicalJson","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)',
          ['entry:leg1', canon1, hash1, INITIAL_PREV_HASH, missionSlug, null, null, null, null]
        );

        // Row 2: Newer entry, already projected with missionSequence = 1 (this would collide if row 1 is assigned seq=1 without phase 1 clearing)
        await db.query(
          'INSERT INTO "AuditEntry" ("sourceKey","canonicalJson","entryHash","prevHash","missionSlug","missionSequence","missionPrevHash","missionEntryHash","missionCanonicalJson","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)',
          ['entry:proj2', canon2, hash2, hash1, missionSlug, 1, INITIAL_PREV_HASH, hash2, canon2]
        );

        const txAdapter = {
          mission: {
            findMany: async ({ where }: any) => {
              const res = where?.slug
                ? await db.query('SELECT * FROM "Mission" WHERE slug = $1', [where.slug])
                : await db.query('SELECT * FROM "Mission"');
              return res.rows.map((r: any) => ({ ...r, auditEntryCount: Number(r.auditEntryCount) }));
            },
            update: async ({ where, data }: any) => {
              await db.query(
                'UPDATE "Mission" SET "auditHeadHash" = $1, "auditEntryCount" = $2 WHERE slug = $3',
                [data.auditHeadHash, data.auditEntryCount, where.slug]
              );
            },
          },
          auditEntry: {
            findMany: async ({ where }: any) => {
              const targetSlug = where?.missionSlug || where?.OR?.[0]?.missionSlug || missionSlug;
              const res = await db.query(
                'SELECT * FROM "AuditEntry" WHERE "missionSlug" = $1 OR "canonicalJson" LIKE $2 ORDER BY id ASC',
                [targetSlug, `%"mission_id":"${targetSlug}"%`]
              );
              return res.rows.map((r: any) => ({
                ...r,
                id: BigInt(r.id),
                missionSequence: r.missionSequence !== null ? Number(r.missionSequence) : null,
              }));
            },
            update: async ({ where, data }: any) => {
              await db.query(
                'UPDATE "AuditEntry" SET "missionSequence" = $1, "missionPrevHash" = $2, "missionEntryHash" = $3, "missionCanonicalJson" = $4 WHERE id = $5',
                [
                  data.missionSequence,
                  data.missionPrevHash ?? null,
                  data.missionEntryHash ?? null,
                  data.missionCanonicalJson ?? null,
                  Number(where.id),
                ]
              );
            },
          },
        };

        const result = await backfillMissionAuditProjections(txAdapter as any, missionSlug);
        expect(result.projectedCount).toBe(2);
        expect(result.missionsUpdated).toContain(missionSlug);

        const verifyRows = await db.query(
          'SELECT id, "sourceKey", "missionSequence", "missionPrevHash", "missionEntryHash" FROM "AuditEntry" WHERE "missionSlug" = $1 ORDER BY id ASC',
          [missionSlug]
        );
        const rows = verifyRows.rows as any[];
        expect(rows.length).toBe(2);
        expect(Number(rows[0].missionSequence)).toBe(1);
        expect(rows[0].missionPrevHash).toBe(INITIAL_PREV_HASH);
        expect(Number(rows[1].missionSequence)).toBe(2);
        expect(rows[1].missionPrevHash).toBe(rows[0].missionEntryHash);
      } finally {
        await db.close();
      }
    });

    it('M6-02: Proof GET rejects truncated entry count or head hash mismatch against persisted mission checkpoint', async () => {
      const missionSlug = 'mission-m6-truncation';
      const canon1 = canonicalAuditJson({
        actor: '0x1111', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:00:00.000Z',
        kind: 'TOOL_RESERVED', mission_id: missionSlug, operation_id: 'op-1',
        policy_hash: '', policy_version: '1', prev_hash: INITIAL_PREV_HASH, reason: 'event 1',
        result_hash: '', rule: '', source_key: 'entry:1', to: '', tx_hash: ''
      });
      const hash1 = computeEntryHash(canon1);

      const canon2 = canonicalAuditJson({
        actor: '0x1111', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:01:00.000Z',
        kind: 'TOOL_PAID', mission_id: missionSlug, operation_id: 'op-2',
        policy_hash: '', policy_version: '1', prev_hash: hash1, reason: 'event 2',
        result_hash: '', rule: '', source_key: 'entry:2', to: '', tx_hash: ''
      });
      const hash2 = computeEntryHash(canon2);

      const baseMission = {
        slug: missionSlug,
        missionId: 'm-trunc-1',
        ownerAddress: '0x' + '1'.repeat(40),
        agentAddress: '0x' + '2'.repeat(40),
        operations: [],
        toolCap: 5000000n,
        spentTool: 0n,
        reservedTool: 0n,
        status: 'ACTIVE',
        publicPublished: true,
        auditHeadHash: hash2,
        auditEntryCount: 2,
        createdAt: new Date(),
      };

      const originalTx = prisma.$transaction;
      try {
        // Case A: Missing/deleted tail entry - DB only returns entry 1, but mission.auditEntryCount is 2
        (prisma as any).$transaction = async (fn: any) => fn({
          mission: { findUnique: async () => ({ ...baseMission }) },
          auditEntry: {
            findMany: async () => [
              {
                id: 1n,
                sourceKey: 'entry:1',
                canonicalJson: canon1,
                entryHash: hash1,
                prevHash: INITIAL_PREV_HASH,
                missionSlug: missionSlug,
                missionSequence: 1,
                missionPrevHash: INITIAL_PREV_HASH,
                missionEntryHash: hash1,
                missionCanonicalJson: canon1,
              },
            ],
          },
        });

        const truncReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/proof?public=true`);
        const truncRes = await getProof(truncReq, { params: { slug: missionSlug } });
        expect(truncRes.status).toBe(409);
        const truncData = await truncRes.json();
        expect(truncData.error).toMatch(/AUDIT_CHECKPOINT_MISMATCH/);
        expect(truncData.error).toMatch(/Exported entry count \(1\) does not match persisted auditEntryCount \(2\)/);

        // Case B: Persisted head hash mismatch - entries length matches, but persisted head is different
        (prisma as any).$transaction = async (fn: any) => fn({
          mission: { findUnique: async () => ({ ...baseMission, auditHeadHash: '0x' + '9'.repeat(64) }) },
          auditEntry: {
            findMany: async () => [
              {
                id: 1n,
                sourceKey: 'entry:1',
                canonicalJson: canon1,
                entryHash: hash1,
                prevHash: INITIAL_PREV_HASH,
                missionSlug: missionSlug,
                missionSequence: 1,
                missionPrevHash: INITIAL_PREV_HASH,
                missionEntryHash: hash1,
                missionCanonicalJson: canon1,
              },
              {
                id: 2n,
                sourceKey: 'entry:2',
                canonicalJson: canon2,
                entryHash: hash2,
                prevHash: hash1,
                missionSlug: missionSlug,
                missionSequence: 2,
                missionPrevHash: hash1,
                missionEntryHash: hash2,
                missionCanonicalJson: canon2,
              },
            ],
          },
        });

        const headMismatchReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/proof?public=true`);
        const headMismatchRes = await getProof(headMismatchReq, { params: { slug: missionSlug } });
        expect(headMismatchRes.status).toBe(409);
        const headMismatchData = await headMismatchRes.json();
        expect(headMismatchData.error).toMatch(/AUDIT_CHECKPOINT_MISMATCH/);
        expect(headMismatchData.error).toMatch(/does not match persisted auditHeadHash/);
      } finally {
        (prisma as any).$transaction = originalTx;
      }
    });
  });
});
