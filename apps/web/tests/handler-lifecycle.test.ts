import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { POST as postChallenge } from '@/app/api/auth/challenge/route';
import { POST as postMissions, GET as getMissions } from '@/app/api/missions/route';
import { POST as postActivate } from '@/app/api/missions/[slug]/activate/route';
import { POST as postOrchestrate } from '@/app/api/tools/orchestrate/route';
import { POST as postTalkmeterStart } from '@/app/api/tools/talkmeter/start/route';
import { POST as postTalkmeterTick } from '@/app/api/tools/talkmeter/tick/route';
import { POST as postTalkmeterStop } from '@/app/api/tools/talkmeter/stop/route';
import { POST as postComplete } from '@/app/api/missions/[slug]/complete/route';
import { POST as postClose } from '@/app/api/missions/[slug]/close/route';
import { POST as postReadAccess } from '@/app/api/missions/[slug]/read-access/route';
import { GET as getProof } from '@/app/api/missions/[slug]/proof/route';
import { POST as postPublish } from '@/app/api/missions/[slug]/publish/route';
import { GET as getToolOperation } from '@/app/api/tools/operations/[id]/route';
import { prisma } from '@/lib/db';
import { normalizeAddress, hashUtf8 } from '@/lib/chain';
import { INITIAL_PREV_HASH, computeEntryHash, canonicalAuditJson } from '@/lib/audit';
import { verifyProof } from '../../../scripts/verify-proof';

/**
 * Isolated EIP-1193 Mock Wallet Provider
 * Simulates a browser Web3 wallet (MetaMask / Coinbase / Rabby)
 * without leaking private keys or requiring browser extension automation.
 */
export function createMockEip1193Provider(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);

  return {
    account,
    address: account.address,
    async request({ method, params }: { method: string; params?: any[] }): Promise<any> {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account.address];

        case 'personal_sign': {
          const rawMsg =
            params?.[0]?.startsWith('0x') && normalizeAddress(params?.[1]) === normalizeAddress(account.address)
              ? params[0]
              : params?.[1]?.startsWith('0x') && normalizeAddress(params?.[0]) === normalizeAddress(account.address)
              ? params[1]
              : params?.[0];

          let messageToSign = rawMsg;
          if (typeof rawMsg === 'string' && rawMsg.startsWith('0x')) {
            try {
              messageToSign = Buffer.from(rawMsg.slice(2), 'hex').toString('utf8');
            } catch {
              messageToSign = rawMsg;
            }
          }

          return await account.signMessage({
            message: messageToSign,
          });
        }

        case 'eth_signTypedData_v4': {
          const typedData = typeof params?.[1] === 'string' ? JSON.parse(params[1]) : params?.[1];
          return await account.signTypedData(typedData);
        }

        default:
          throw new Error(`Unsupported mock RPC method: ${method}`);
      }
    },
  };
}

describe('Handler Lifecycle Smoke & Boundary Suite (Mocked DB & Services)', () => {
  const TEST_OWNER_KEY =
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
  const TEST_AGENT_KEY =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

  const ownerWallet = createMockEip1193Provider(TEST_OWNER_KEY);
  const agentWallet = createMockEip1193Provider(TEST_AGENT_KEY);

  const missionSlug = 'mission-handler-lifecycle';
  const missionId = hashUtf8(missionSlug);

  const mockSystemState = {
    id: 1,
    deploymentId: 'unihack-s1-deployment',
    stage: 'S1',
    guardAddress: '0x3333333333333333333333333333333333333333',
    authVersion: 1,
    systemPaused: false,
    maintenance: false,
    updatedAt: new Date(),
  };

  let inMemoryMission: any;
  const inMemoryChallenges = new Map<string, any>();
  const inMemoryOperations = new Map<string, any>();
  const inMemorySessions = new Map<string, any>();
  const inMemoryAuditEntries: any[] = [];

  // Environment and Delegate snapshot for full isolation
  const savedEnv = { ...process.env };
  const origSystemState = (prisma as any).systemState;
  const origAuthChallenge = (prisma as any).authChallenge;
  const origMission = (prisma as any).mission;
  const origToolOperation = (prisma as any).toolOperation;
  const origAuditHead = (prisma as any).auditHead;
  const origAuditEntry = (prisma as any).auditEntry;
  const origToolSession = (prisma as any).toolSession;
  const origValidationJob = (prisma as any).validationJob;
  const origTx = prisma.$transaction;
  const origQueryRaw = prisma.$queryRaw;

  beforeEach(() => {
    inMemoryChallenges.clear();
    inMemoryOperations.clear();
    inMemorySessions.clear();
    inMemoryAuditEntries.length = 0;

    const inMemoryValidationJobs = new Map<string, any>();
    (prisma as any).validationJob = {
      upsert: async ({ where, create, update }: any) => {
        const existing = inMemoryValidationJobs.get(where.missionSlug);
        const job = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : { ...create, createdAt: new Date(), updatedAt: new Date() };
        inMemoryValidationJobs.set(where.missionSlug, job);
        return job;
      },
      findUnique: async ({ where }: any) => inMemoryValidationJobs.get(where.missionSlug) || null,
      update: async ({ where, data }: any) => {
        const existing = inMemoryValidationJobs.get(where.missionSlug);
        if (!existing) return null;
        const job = { ...existing, ...data, updatedAt: new Date() };
        inMemoryValidationJobs.set(where.missionSlug, job);
        return job;
      },
    };

    inMemoryMission = {
      slug: missionSlug,
      missionId,
      ownerAddress: normalizeAddress(ownerWallet.address),
      agentAddress: normalizeAddress(agentWallet.address),
      treasuryCap: 10000000n,
      toolCap: 5000000n,
      spentTool: 0n,
      reservedTool: 0n,
      expiresAt: new Date(Date.now() + 86400000),
      status: 'ACTIVE',
      completedAt: null as Date | null,
      deliverableHash: null as string | null,
      configVersion: 1,
      policyHash: '0x' + '1'.repeat(64),
      auditHeadHash: INITIAL_PREV_HASH,
      auditEntryCount: 0,
      publicPublished: false,
      publicationVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    process.env.APP_ORIGIN = 'http://localhost:3000';
    process.env.DEPLOYMENT_ID = 'unihack-s1-deployment';
    process.env.OWNER_ADDRESS = normalizeAddress(ownerWallet.address);
    process.env.AGENT_PRIVATE_KEY = TEST_AGENT_KEY;
    process.env.PAYMENT_MODE = 'MOCK';
    process.env.MISSION_TOKEN_SECRET = 'test-mission-token-secret-must-be-at-least-32-chars-long!';

    // Setup Prisma in-memory delegates
    (prisma as any).systemState = {
      findUnique: async () => mockSystemState,
    };

    (prisma as any).authChallenge = {
      create: async ({ data }: any) => {
        const item = { usedAt: null, createdAt: new Date(), ...data };
        inMemoryChallenges.set(data.nonce, item);
        return item;
      },
      findUnique: async ({ where }: any) => inMemoryChallenges.get(where.nonce) || null,
      updateMany: async ({ where, data }: any) => {
        const item = inMemoryChallenges.get(where.nonce);
        if (item && item.usedAt === null) {
          Object.assign(item, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
      delete: async ({ where }: any) => {
        const item = inMemoryChallenges.get(where.nonce);
        inMemoryChallenges.delete(where.nonce);
        return item;
      },
    };

    (prisma as any).mission = {
      findUnique: async ({ where, include }: any) => {
        if (where.slug === missionSlug || where.missionId === missionId) {
          return {
            ...inMemoryMission,
            operations: include?.operations ? Array.from(inMemoryOperations.values()) : [],
          };
        }
        return null;
      },
      findMany: async ({ where }: any) => {
        if (where?.publicPublished) {
          return inMemoryMission.publicPublished ? [{ ...inMemoryMission }] : [];
        }
        if (where?.slug) {
          return where.slug === missionSlug ? [{ ...inMemoryMission }] : [];
        }
        return [{ ...inMemoryMission }];
      },
      create: async ({ data }: any) => {
        Object.assign(inMemoryMission, data);
        return {
          ...inMemoryMission,
          spentTool: inMemoryMission.spentTool?.toString() || '0',
          reservedTool: inMemoryMission.reservedTool?.toString() || '0',
          treasuryCap: inMemoryMission.treasuryCap?.toString() || '0',
          toolCap: inMemoryMission.toolCap?.toString() || '0',
        };
      },
      update: async ({ where, data }: any) => {
        let curSpent = BigInt(inMemoryMission.spentTool?.toString() || '0');
        let curReserved = BigInt(inMemoryMission.reservedTool?.toString() || '0');
        if (data.spentTool?.increment) {
          curSpent += BigInt(data.spentTool.increment.toString());
        }
        if (data.reservedTool?.increment) {
          curReserved += BigInt(data.reservedTool.increment.toString());
        }
        if (data.reservedTool?.decrement) {
          curReserved -= BigInt(data.reservedTool.decrement.toString());
        }
        const cleanData = { ...data };
        delete cleanData.spentTool;
        delete cleanData.reservedTool;
        Object.assign(inMemoryMission, cleanData);
        inMemoryMission.spentTool = curSpent.toString();
        inMemoryMission.reservedTool = curReserved.toString();
        return { ...inMemoryMission };
      },
    };

    (prisma as any).toolOperation = {
      findUnique: async ({ where, include }: any) => {
        const op = inMemoryOperations.get(where.operationId) || null;
        if (!op) return null;
        return {
          ...op,
          mission: include?.mission ? { ...inMemoryMission } : undefined,
          session: include?.session ? (op.sessionId ? inMemorySessions.get(op.sessionId) : null) : undefined,
        };
      },
      findFirst: async ({ where }: any) => {
        for (const op of inMemoryOperations.values()) {
          if (where.sessionId && op.sessionId !== where.sessionId) continue;
          if (where.minuteIndex !== undefined && op.minuteIndex !== where.minuteIndex) continue;
          if (where.missionSlug && op.missionSlug !== where.missionSlug) continue;
          return { ...op };
        }
        return null;
      },
      findMany: async ({ where, orderBy }: any) => {
        let ops = Array.from(inMemoryOperations.values());
        if (where?.sessionId) {
          ops = ops.filter((o) => o.sessionId === where.sessionId);
        }
        if (where?.missionSlug) {
          ops = ops.filter((o) => o.missionSlug === where.missionSlug);
        }
        return ops;
      },
      create: async ({ data }: any) => {
        const op = { ...data, createdAt: new Date(), updatedAt: new Date() };
        inMemoryOperations.set(data.operationId, op);
        return { ...op };
      },
      update: async ({ where, data }: any) => {
        const cur = inMemoryOperations.get(where.operationId);
        if (cur) Object.assign(cur, data, { updatedAt: new Date() });
        return cur ? { ...cur } : null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const op of inMemoryOperations.values()) {
          if (where.operationId && op.operationId !== where.operationId) continue;
          if (where.state && op.state !== where.state) continue;
          if (where.workerLeaseOwner && op.workerLeaseOwner !== where.workerLeaseOwner) continue;
          Object.assign(op, data, { updatedAt: new Date() });
          count++;
        }
        return { count };
      },
    };

    (prisma as any).toolSession = {
      create: async ({ data }: any) => {
        const s = {
          ...data,
          spent: '0',
          reserved: '0',
          operations: [],
          startedAt: data.startedAt instanceof Date ? data.startedAt : new Date(),
          stoppedAt: null,
        };
        inMemorySessions.set(data.id, s);
        return { ...s };
      },
      findUnique: async ({ where, include }: any) => {
        const s = inMemorySessions.get(where.id);
        if (!s) return null;
        let ops: any[] = [];
        if (include?.operations) {
          ops = Array.from(inMemoryOperations.values()).filter((o) => o.sessionId === s.id);
          ops.sort((a, b) => (a.minuteIndex ?? 0) - (b.minuteIndex ?? 0));
        }
        return { ...s, operations: ops };
      },
      update: async ({ where, data }: any) => {
        const s = inMemorySessions.get(where.id);
        if (!s) return null;
        if (data.spent?.increment) {
          s.spent = (BigInt(s.spent || '0') + BigInt(data.spent.increment.toString())).toString();
        }
        if (data.reserved?.increment) {
          s.reserved = (BigInt(s.reserved || '0') + BigInt(data.reserved.increment.toString())).toString();
        }
        if (data.reserved?.decrement) {
          s.reserved = (BigInt(s.reserved || '0') - BigInt(data.reserved.decrement.toString())).toString();
        }
        const clean = { ...data };
        delete clean.spent;
        delete clean.reserved;
        Object.assign(s, clean);
        return { ...s };
      },
    };

    (prisma as any).auditHead = {
      findUnique: async () => ({ id: 1, lastHash: INITIAL_PREV_HASH }),
      update: async ({ data }: any) => ({ id: 1, lastHash: data.lastHash }),
    };

    (prisma as any).auditEntry = {
      findUnique: async ({ where }: any) => {
        if (where.sourceKey) return inMemoryAuditEntries.find((e) => e.sourceKey === where.sourceKey) || null;
        if (where.id) return inMemoryAuditEntries.find((e) => e.id === BigInt(where.id)) || null;
        return null;
      },
      findMany: async ({ where, orderBy }: any) => {
        let entries = [...inMemoryAuditEntries];
        if (where?.OR) {
          entries = entries.filter((e) =>
            where.OR.some((cond: any) =>
              cond.missionSlug ? e.missionSlug === cond.missionSlug : e.canonicalJson.includes(`"mission_id":"${missionSlug}"`)
            )
          );
        }
        return entries;
      },
      create: async ({ data }: any) => {
        const newEntry = {
          id: BigInt(inMemoryAuditEntries.length + 1),
          ...data,
          createdAt: new Date(),
        };
        inMemoryAuditEntries.push(newEntry);
        return newEntry;
      },
      createMany: async ({ data }: any) => {
        for (const item of data) {
          inMemoryAuditEntries.push({
            id: BigInt(inMemoryAuditEntries.length + 1),
            ...item,
            createdAt: new Date(),
          });
        }
        return { count: data.length };
      },
    };

    (prisma as any).$queryRaw = async () => [];
    (prisma as any).$transaction = async (arg: any, opts?: any) => {
      if (typeof arg === 'function') {
        return await arg(prisma);
      }
      return arg;
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.env = { ...savedEnv };
    (prisma as any).systemState = origSystemState;
    (prisma as any).authChallenge = origAuthChallenge;
    (prisma as any).mission = origMission;
    (prisma as any).toolOperation = origToolOperation;
    (prisma as any).auditHead = origAuditHead;
    (prisma as any).auditEntry = origAuditEntry;
    (prisma as any).toolSession = origToolSession;
    (prisma as any).validationJob = origValidationJob;
    (prisma as any).$transaction = origTx;
    (prisma as any).$queryRaw = origQueryRaw;
  });

  it('Executes the 9-step handler lifecycle with full assertions, TalkMeter exercises, and boundaries', async () => {
    // -------------------------------------------------------------
    // Step 1: Wallet connect RPC and EIP-191 Challenge signing
    // -------------------------------------------------------------
    const accounts = await ownerWallet.request({ method: 'eth_requestAccounts' });
    expect(accounts).toEqual([ownerWallet.address]);
    const accountsCheck = await ownerWallet.request({ method: 'eth_accounts' });
    expect(accountsCheck).toEqual([ownerWallet.address]);

    const createPayload = {
      slug: missionSlug,
      agentAddress: normalizeAddress(agentWallet.address),
      treasuryCap: '10000000',
      toolCap: '5000000',
      durationSeconds: 86400,
    };

    const challengeReq1 = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CREATE_MISSION',
        payload: createPayload,
        expectedSigner: ownerWallet.address,
        targetMissionSlug: missionSlug,
      }),
    });
    const challengeRes1 = await postChallenge(challengeReq1);
    expect(challengeRes1.status).toBe(200);
    const challengeData1 = await challengeRes1.json();
    expect(challengeData1.nonce).toBeDefined();

    const signature1 = await ownerWallet.request({
      method: 'personal_sign',
      params: [challengeData1.message, ownerWallet.address],
    });
    expect(signature1).toMatch(/^0x[0-9a-fA-F]{130}$/);

    // -------------------------------------------------------------
    // Step 2: Create Mission and Activate Mission
    // -------------------------------------------------------------
    const createReq = new NextRequest('http://localhost:3000/api/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: challengeData1.nonce,
        signature: signature1,
        payload: createPayload,
      }),
    });
    const createRes = await postMissions(createReq);
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    expect(createData.mission.slug).toBe(missionSlug);

    const activatePayload = {
      missionId,
      ownerAddress: normalizeAddress(ownerWallet.address),
      agentAddress: normalizeAddress(agentWallet.address),
      treasuryCap: '10000000',
      toolCap: '5000000',
      configVersion: 1,
      policyHash: inMemoryMission.policyHash,
    };
    const challengeReq2 = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACTIVATE',
        payload: activatePayload,
        expectedSigner: ownerWallet.address,
        targetMissionSlug: missionSlug,
      }),
    });
    const challengeRes2 = await postChallenge(challengeReq2);
    expect(challengeRes2.status).toBe(200);
    const challengeData2 = await challengeRes2.json();

    const signature2 = await ownerWallet.request({
      method: 'personal_sign',
      params: [challengeData2.message, ownerWallet.address],
    });

    const activateReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: challengeData2.nonce,
        signature: signature2,
        payload: activatePayload,
      }),
    });
    const activateRes = await postActivate(activateReq, { params: { slug: missionSlug } });
    expect(activateRes.status).toBe(200);
    const activateData = await activateRes.json();
    expect(activateData.spendToken).toBeDefined();
    const spendToken = activateData.spendToken;

    // -------------------------------------------------------------
    // Step 3: Tool Orchestration & Stable operationId Idempotency Check
    // -------------------------------------------------------------
    const stableOpId = '11111111-2222-3333-4444-555555555555';
    const orchestrateReq1 = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        operationId: stableOpId,
        toolId: 'tool:search',
        input: { query: 'Avalanche Fuji gasless payment x402' },
      }),
    });
    const orchestrateRes1 = await postOrchestrate(orchestrateReq1);
    expect(orchestrateRes1.status).toBe(200);
    const orchData1 = await orchestrateRes1.json();
    expect(orchData1.state).toBe('SETTLED');
    expect(orchData1.result).toBeDefined();
    expect(BigInt(inMemoryMission.spentTool.toString())).toBe(100000n);

    // Idempotency: replay same operationId must NOT charge second time
    const orchestrateReq2 = new NextRequest('http://localhost:3000/api/tools/orchestrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({
        operationId: stableOpId,
        toolId: 'tool:search',
        input: { query: 'Avalanche Fuji gasless payment x402' },
      }),
    });
    const orchestrateRes2 = await postOrchestrate(orchestrateReq2);
    expect(orchestrateRes2.status).toBe(200);
    const orchData2 = await orchestrateRes2.json();
    expect(orchData2.state).toBe('SETTLED');
    expect(orchData2.result).toEqual(orchData1.result);
    // Tool budget spent did not double
    expect(BigInt(inMemoryMission.spentTool.toString())).toBe(100000n);

    // -------------------------------------------------------------
    // Step 4: Protect Honest UNKNOWN and Pending State Invariants
    // -------------------------------------------------------------
    const submittingOp = {
      operationId: 'submitting-op-id',
      missionSlug,
      toolId: 'tool:test',
      payerAddress: normalizeAddress(agentWallet.address),
      sellerAddress: '0x0000000000000000000000000000000000000002',
      input: '{}',
      inputHash: '0xinput',
      paymentTerms: '{}',
      paymentTermsHash: '0xterms',
      policyHash: inMemoryMission.policyHash,
      chainId: 43113,
      asset: '0x5425890298aed601595a70ab815c96711a31bc65',
      state: 'SUBMITTING',
      paymentMode: 'MOCK',
      version: 0,
      authDeploymentVersion: 1,
      quoteExpiresAt: new Date(Date.now() + 600000),
      reservedAmount: '100000',
      heldResult: null,
      heldResultHash: null,
      txHash: null,
      receiptBlockNumber: null,
      receiptBlockHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    inMemoryOperations.set(submittingOp.operationId, submittingOp);

    const checkSubmittingReq = new NextRequest(`http://localhost:3000/api/tools/operations/${submittingOp.operationId}`, {
      headers: { Authorization: `Bearer ${spendToken}` },
    });
    const checkSubmittingRes = await getToolOperation(checkSubmittingReq, { params: { id: submittingOp.operationId } });
    expect(checkSubmittingRes.status).toBe(200);
    const submittingData = await checkSubmittingRes.json();
    expect(submittingData.state).toBe('SUBMITTING');
    expect(submittingData.state).not.toBe('SETTLED');
    expect(submittingData.result).toBeNull();

    const unknownOp = {
      ...submittingOp,
      operationId: 'unknown-op-id',
      state: 'UNKNOWN',
      failureReason: 'FACILITATOR_TIMEOUT_OR_UNAVAILABLE',
    };
    inMemoryOperations.set(unknownOp.operationId, unknownOp);

    const checkUnknownReq = new NextRequest(`http://localhost:3000/api/tools/operations/${unknownOp.operationId}`, {
      headers: { Authorization: `Bearer ${spendToken}` },
    });
    const checkUnknownRes = await getToolOperation(checkUnknownReq, { params: { id: unknownOp.operationId } });
    expect(checkUnknownRes.status).toBe(200);
    const unknownData = await checkUnknownRes.json();
    expect(unknownData.state).toBe('UNKNOWN');
    expect(unknownData.state).not.toBe('SETTLED');
    expect(unknownData.result).toBeNull();
    expect(unknownData.failureReason).toBe('FACILITATOR_TIMEOUT_OR_UNAVAILABLE');

    // -------------------------------------------------------------
    // Step 5: TalkMeter Start, Server-Time Controlled Ticks, Minute Boundaries & Stop
    // -------------------------------------------------------------
    const startReq = new NextRequest('http://localhost:3000/api/tools/talkmeter/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ rate: '50000', cap: '500000' }),
    });
    const startRes = await postTalkmeterStart(startReq);
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    expect(startData.session.id).toBeDefined();
    expect(startData.session.status).toBe('ACTIVE');
    const sessionId = startData.session.id;

    // Calling tick immediately before 60 seconds elapsed must reject with 400
    const prematureTickReq = new NextRequest('http://localhost:3000/api/tools/talkmeter/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ sessionId }),
    });
    const prematureTickRes = await postTalkmeterTick(prematureTickReq);
    expect(prematureTickRes.status).toBe(400);
    const prematureErr = await prematureTickRes.json();
    expect(prematureErr.error).toContain('requires at least 60 seconds elapsed');

    // Simulate 65 seconds elapsed: minute 0 is now completed
    const sessionObj = inMemorySessions.get(sessionId);
    sessionObj.startedAt = new Date(Date.now() - 65000);

    // Tick minute 0: charges 50000 atomic units
    const tickReq0 = new NextRequest('http://localhost:3000/api/tools/talkmeter/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ sessionId }),
    });
    const tickRes0 = await postTalkmeterTick(tickReq0);
    expect(tickRes0.status).toBe(200);
    const tickData0 = await tickRes0.json();
    expect(tickData0.minuteIndex).toBe(0);
    expect(tickData0.operation.state).toBe('SETTLED');
    expect(sessionObj.spent).toBe('50000');

    // Immediate retry in same minute without advancing time: returns already billed, no double charge
    const tickReq0Retry = new NextRequest('http://localhost:3000/api/tools/talkmeter/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ sessionId }),
    });
    const tickRes0Retry = await postTalkmeterTick(tickReq0Retry);
    expect(tickRes0Retry.status).toBe(200);
    const tickRetryData = await tickRes0Retry.json();
    expect(tickRetryData.message).toContain('Current completed minutes already billed');
    expect(sessionObj.spent).toBe('50000');

    // Advance elapsed time past 125 seconds: minute 1 is now completed
    sessionObj.startedAt = new Date(Date.now() - 125000);

    // Tick minute 1: charges another 50000 units, bringing total to 100000
    const tickReq1 = new NextRequest('http://localhost:3000/api/tools/talkmeter/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ sessionId }),
    });
    const tickRes1 = await postTalkmeterTick(tickReq1);
    expect(tickRes1.status).toBe(200);
    const tickData1 = await tickRes1.json();
    expect(tickData1.minuteIndex).toBe(1);
    expect(tickData1.operation.state).toBe('SETTLED');
    expect(sessionObj.spent).toBe('100000');

    // Stop session
    const stopReq = new NextRequest('http://localhost:3000/api/tools/talkmeter/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ sessionId }),
    });
    const stopRes = await postTalkmeterStop(stopReq);
    expect(stopRes.status).toBe(200);
    const stopData = await stopRes.json();
    expect(stopData.session.status).toBe('STOPPED');
    expect(sessionObj.status).toBe('STOPPED');

    // Ticking stopped session must be rejected and not increment spent
    const postStopTickReq = new NextRequest('http://localhost:3000/api/tools/talkmeter/tick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${spendToken}`,
      },
      body: JSON.stringify({ sessionId }),
    });
    const postStopTickRes = await postTalkmeterTick(postStopTickReq);
    expect(postStopTickRes.status).toBe(400);
    expect(sessionObj.spent).toBe('100000');

    // -------------------------------------------------------------
    // Step 6: Complete Mission with Verified Deliverable Hash
    // -------------------------------------------------------------
    const realArtifactBuffer = Buffer.from('Final audit deliverable payload verified for S1 release handoff');
    const deliverableHash = ('0x' + crypto.createHash('sha256').update(realArtifactBuffer).digest('hex')) as `0x${string}`;

    const completePayload = { slug: missionSlug, deliverableHash };
    const challengeReq3 = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'COMPLETE_MISSION',
        payload: completePayload,
        expectedSigner: ownerWallet.address,
        targetMissionSlug: missionSlug,
      }),
    });
    const challengeRes3 = await postChallenge(challengeReq3);
    expect(challengeRes3.status).toBe(200);
    const challengeData3 = await challengeRes3.json();

    const signature3 = await ownerWallet.request({
      method: 'personal_sign',
      params: [challengeData3.message, ownerWallet.address],
    });

    const completeReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: challengeData3.nonce,
        signature: signature3,
        payload: completePayload,
      }),
    });
    const completeRes = await postComplete(completeReq, { params: { slug: missionSlug } });
    expect(completeRes.status).toBe(200);
    expect(inMemoryMission.completedAt).not.toBeNull();
    expect(inMemoryMission.deliverableHash).toBe(deliverableHash);

    // -------------------------------------------------------------
    // Step 7: Close Mission via Challenge and Read-Access Historic Recovery
    // -------------------------------------------------------------
    const closePayload = { slug: missionSlug };
    const challengeReq4 = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CLOSE_MISSION_S1',
        payload: closePayload,
        expectedSigner: ownerWallet.address,
        targetMissionSlug: missionSlug,
      }),
    });
    const challengeRes4 = await postChallenge(challengeReq4);
    expect(challengeRes4.status).toBe(200);
    const challengeData4 = await challengeRes4.json();

    const signature4 = await ownerWallet.request({
      method: 'personal_sign',
      params: [challengeData4.message, ownerWallet.address],
    });

    const closeReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: challengeData4.nonce,
        signature: signature4,
        payload: closePayload,
      }),
    });
    const closeRes = await postClose(closeReq, { params: { slug: missionSlug } });
    expect(closeRes.status).toBe(200);
    expect(inMemoryMission.status).toBe('CLOSED');

    // Read access token request via signed READ_MISSION challenge
    const readPayload = { slug: missionSlug };
    const challengeReqRead = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'READ_MISSION',
        payload: readPayload,
        expectedSigner: ownerWallet.address,
        targetMissionSlug: missionSlug,
      }),
    });
    const challengeResRead = await postChallenge(challengeReqRead);
    expect(challengeResRead.status).toBe(200);
    const challengeDataRead = await challengeResRead.json();

    const signatureRead = await ownerWallet.request({
      method: 'personal_sign',
      params: [challengeDataRead.message, ownerWallet.address],
    });

    const readAccessReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/read-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: challengeDataRead.nonce,
        signature: signatureRead,
        payload: readPayload,
      }),
    });
    const readAccessRes = await postReadAccess(readAccessReq, { params: { slug: missionSlug } });
    expect(readAccessRes.status).toBe(200);
    const readAccessData = await readAccessRes.json();
    expect(readAccessData.readToken).toBeDefined();
    const readToken = readAccessData.readToken;

    // Use readToken to recover settled operation result
    const recoverReq = new NextRequest(`http://localhost:3000/api/tools/operations/${stableOpId}`, {
      headers: { Authorization: `Bearer ${readToken}` },
    });
    const recoverRes = await getToolOperation(recoverReq, { params: { id: stableOpId } });
    expect(recoverRes.status).toBe(200);
    const recoverData = await recoverRes.json();
    expect(recoverData.result).toBeDefined();

    // -------------------------------------------------------------
    // Step 8: Audit Chain Export, Continuous Verification & Security Boundaries
    // -------------------------------------------------------------
    // Anonymous access denial: private mission proof without token returns 401
    const anonProofReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/proof`);
    const anonProofRes = await getProof(anonProofReq, { params: { slug: missionSlug } });
    expect(anonProofRes.status).toBe(401);

    // Anonymous operation check without token returns 401
    const anonOpReq = new NextRequest(`http://localhost:3000/api/tools/operations/${stableOpId}`);
    const anonOpRes = await getToolOperation(anonOpReq, { params: { id: stableOpId } });
    expect(anonOpRes.status).toBe(401);

    // Authorized proof export via readToken
    const authProofReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/proof`, {
      headers: { Authorization: `Bearer ${readToken}` },
    });
    const authProofRes = await getProof(authProofReq, { params: { slug: missionSlug } });
    expect(authProofRes.status).toBe(200);
    const proofData = await authProofRes.json();
    expect(proofData.audit.checkpoint.headHash).toBe(inMemoryMission.auditHeadHash);
    expect(proofData.audit.checkpoint.entryCount).toBe(inMemoryMission.auditEntryCount);
    expect(proofData.audit.entries.length).toBe(inMemoryMission.auditEntryCount);

    const verifierCheck = verifyProof(proofData.audit.entries, proofData.audit.checkpoint);
    expect(verifierCheck.valid).toBe(true);

    // -------------------------------------------------------------
    // Step 9: Public/Private Boundary & Publication Enforcement
    // -------------------------------------------------------------
    const listReq1 = new NextRequest('http://localhost:3000/api/missions');
    const listRes1 = await getMissions(listReq1);
    expect(listRes1.status).toBe(200);
    const listData1 = await listRes1.json();
    expect(listData1.missions.some((m: any) => m.slug === missionSlug)).toBe(false);

    // Publish mission via challenge
    const publishPayload = { slug: missionSlug, publicPublished: true };
    const challengeReq5 = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'PUBLISH_MISSION',
        payload: publishPayload,
        expectedSigner: ownerWallet.address,
        targetMissionSlug: missionSlug,
      }),
    });
    const challengeRes5 = await postChallenge(challengeReq5);
    expect(challengeRes5.status).toBe(200);
    const challengeData5 = await challengeRes5.json();

    const signature5 = await ownerWallet.request({
      method: 'personal_sign',
      params: [challengeData5.message, ownerWallet.address],
    });

    const publishReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce: challengeData5.nonce,
        signature: signature5,
        payload: publishPayload,
      }),
    });
    const publishRes = await postPublish(publishReq, { params: { slug: missionSlug } });
    expect(publishRes.status).toBe(200);
    expect(inMemoryMission.publicPublished).toBe(true);

    // Mission now appears in public list
    const listReq2 = new NextRequest('http://localhost:3000/api/missions');
    const listRes2 = await getMissions(listReq2);
    expect(listRes2.status).toBe(200);
    const listData2 = await listRes2.json();
    expect(listData2.missions.some((m: any) => m.slug === missionSlug)).toBe(true);

    // Public proof is accessible anonymously, but operation results are stripped (result: null)
    const pubProofReq = new NextRequest(`http://localhost:3000/api/missions/${missionSlug}/proof?public=true`);
    const pubProofRes = await getProof(pubProofReq, { params: { slug: missionSlug } });
    expect(pubProofRes.status).toBe(200);
    const pubProofData = await pubProofRes.json();
    expect(pubProofData.audit.checkpoint.headHash).toBe(inMemoryMission.auditHeadHash);
    for (const op of pubProofData.operations) {
      expect(op.result).toBeNull();
    }
  });
});
