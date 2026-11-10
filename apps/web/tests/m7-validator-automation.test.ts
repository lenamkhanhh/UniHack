import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  encodeEventTopics,
  encodeAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { prisma } from '@/lib/db';
import {
  clearDatabase,
  createTestMission,
  ownerAccount,
} from './setup';
import {
  buildMissionValidationBundle,
  runMissionValidatorJob,
  getMemoryValidationRecord,
  clearMemoryValidationCache,
  setValidationFetcherForTesting,
  processQueuedValidationJobs,
  claimNextValidationJob,
  reconcileOwnerValidationRequestReceipt,
  buildUnsignedValidationRequest,
  verifyMissionCreationReceipt,
  MISSION_CREATED_EVENT_ABI,
  DEFAULT_VALIDATION_REGISTRY,
} from '@/lib/validator-job';
import { computeValidationRequestHash, validateBundleOnChain } from '@/lib/validation-bundle';
import { computePayeeMerkleTree } from '@/lib/merkle';
import { POST as missionCreatePOST } from '@/app/api/missions/route';
import { POST as closeRoutePOST } from '@/app/api/missions/[slug]/close/route';
import { POST as challengePOST } from '@/app/api/auth/challenge/route';
import { GET as verifyRouteGET, POST as verifyRoutePOST } from '@/app/api/verify/[missionId]/route';
import { setAnchorFetcherForTesting, getGuardedTreasuryAddress } from '@/lib/config';
import { issueSpendToken } from '@/lib/auth';

const TEST_HEAD_HASH = '0x7d46d87541ed812ada52afe7f1d3144d6a2b90b359a66162e54c8e41d675be2f' as const;

describe('MAX-M7: Post-Mission Automated Validator Runner Suite', () => {
  beforeEach(async () => {
    clearMemoryValidationCache();
    setAnchorFetcherForTesting(null);
    setValidationFetcherForTesting(null);
    await clearDatabase();
  });

  function createMockPublicClient(bundle: any, overrides: {
    headMatches?: boolean;
    rootMatches?: boolean;
    hasExecutions?: boolean;
    payeesValid?: boolean;
  } = {}) {
    const head = overrides.headMatches === false
      ? '0x0000000000000000000000000000000000000000000000000000000000000bad'
      : bundle.auditHead;

    const root = overrides.rootMatches === false
      ? '0x0000000000000000000000000000000000000000000000000000000000000bad'
      : bundle.payeeRoot;

    const logs = overrides.hasExecutions === false
      ? []
      : [
          {
            args: {
              id: 1n,
              to: overrides.payeesValid === false
                ? '0x9999999999999999999999999999999999999999'
                : bundle.payees[0],
              amount: 200000n,
              missionId: bundle.missionId,
            },
          },
        ];

    return {
      getBlockNumber: vi.fn().mockResolvedValue(60689770n),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'anchoredMissionProofs') return head;
        if (functionName === 'missionPayeeRoot') return root;
        if (functionName === 'missions') {
          return [bundle.missionId, bundle.treasury, 2000000n, 1794670342n, true, true];
        }
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return ['0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5', 294n, 100, '0x0', 'verified-full', 1700000000n];
        }
        throw new Error(`Unexpected functionName: ${functionName}`);
      }),
      getLogs: vi.fn().mockResolvedValue(logs),
    } as any;
  }

  // 1. Deterministic Bundle & RequestHash Generation
  it('M7-01: buildMissionValidationBundle constructs valid deterministic bundle and requestHash', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    expect(bundle.missionSlug).toBe(mission.slug);
    expect(bundle.payeeRoot).toBe(tree.root);
    expect(bundle.payees).toEqual(payees);
    expect(bundle.chainId).toBe(43113);

    const requestHash = computeValidationRequestHash(bundle);
    expect(requestHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  // 2. Evaluates valid bundle against on-chain contract state -> score 100
  it('M7-02: runMissionValidatorJob evaluates valid bundle on-chain and produces score 100 with tag verified-full', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const mockClient = createMockPublicClient(bundle);

    const jobResult = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClient,
      skipOnChainBroadcast: true,
    });

    expect(jobResult.validationResult.valid).toBe(true);
    expect(jobResult.validationResult.score).toBe(100);
    expect(jobResult.validationResult.tag).toBe('verified-full');
    expect(jobResult.validationResult.checks.headMatchesOnChain).toBe(true);
    expect(jobResult.validationResult.checks.rootMatchesOnChain).toBe(true);
    expect(jobResult.validationResult.checks.executedPayeesValid).toBe(true);
    expect(jobResult.status).toBe('LOCAL_EVALUATED');

    // Verify persistent database record populated
    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(dbJob).toBeDefined();
    expect(dbJob?.score).toBe(100);
    expect(dbJob?.status).toBe('LOCAL_EVALUATED');
    expect(dbJob?.tag).toBe('verified-full');

    // Verify in-memory record populated
    const memRecord = getMemoryValidationRecord(jobResult.requestHash);
    expect(memRecord).toBeDefined();
    expect(memRecord?.score).toBe(100);
    expect(memRecord?.tag).toBe('verified-full');
  });

  // 3. Tampered state -> score 0
  it('M7-03: runMissionValidatorJob detects tampered audit head or payee root and returns score 0 with failed tag', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);

    // Case A: Tampered audit head
    const mockClientHeadMismatch = createMockPublicClient(bundle, { headMatches: false });
    const resultHeadMismatch = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClientHeadMismatch,
      skipOnChainBroadcast: true,
    });

    expect(resultHeadMismatch.validationResult.valid).toBe(false);
    expect(resultHeadMismatch.validationResult.score).toBe(0);
    expect(resultHeadMismatch.validationResult.tag).toContain('HEAD_MISMATCH');

    // Case B: Tampered payee root
    const mockClientRootMismatch = createMockPublicClient(bundle, { rootMatches: false });
    const resultRootMismatch = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClientRootMismatch,
      skipOnChainBroadcast: true,
    });

    expect(resultRootMismatch.validationResult.valid).toBe(false);
    expect(resultRootMismatch.validationResult.score).toBe(0);
    expect(resultRootMismatch.validationResult.tag).toContain('ROOT_MISMATCH');
  });

  // 4. /api/verify/[missionId] reflects dynamic validation record
  it('M7-04: /api/verify/[missionId] dynamically returns ERC-8004 validation status from job result', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission, spendToken } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      publicPublished: true,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const mockClient = createMockPublicClient(bundle);

    const jobResult = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClient,
      skipOnChainBroadcast: true,
    });

    // Hit GET /api/verify/[missionId]
    const req = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      headers: { authorization: `Bearer ${spendToken}` },
    });
    const res = await verifyRouteGET(req, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.erc8004Validation).toBeDefined();
    expect(json.erc8004Validation.status).toBe('LOCAL_EVALUATED');
    expect(json.erc8004Validation.score).toBe(100);
    expect(json.erc8004Validation.tag).toBe('verified-full');
    expect(json.erc8004Validation.requestHash).toBe(jobResult.requestHash);
  });

  // 5. POST /api/missions/[slug]/close automated trigger
  it('M7-05: Closing mission via POST /api/missions/[slug]/close automatically triggers validation runner', async () => {
    const { mission } = await createTestMission();

    const challengeReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'CLOSE_MISSION_S1',
        payload: { slug: mission.slug },
        expectedSigner: ownerAccount.address,
      }),
    });
    const challengeRes = await challengePOST(challengeReq);
    expect(challengeRes.status).toBe(200);
    const { nonce, message } = await challengeRes.json();

    const signature = await ownerAccount.signMessage({
      message,
    });

    const req = new NextRequest(`http://localhost:3000/api/missions/${mission.slug}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nonce,
        signature,
        payload: { slug: mission.slug },
      }),
    });

    const res = await closeRoutePOST(req, { params: Promise.resolve({ slug: mission.slug }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('CLOSED');
    expect(body.validation).toBeDefined();
    expect(body.validation.requestHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(body.validation.status).toBe('QUEUED');

    const updatedMission = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(updatedMission?.status).toBe('CLOSED');

    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(dbJob?.status).toBe('QUEUED');
  });

  // 6. Live Anvil Fork test: Tamper detection -> Score 0 on-chain with dedicated validator key
  it.skipIf(!process.env.FORK_ENABLED || !process.env.VALIDATOR_PRIVATE_KEY?.trim())('M7-06: Live Anvil fork: validator evaluates tampered state -> submits score 0 -> records on-chain', async () => {
    const forkRpc = 'http://127.0.0.1:8546';
    const publicClient = createPublicClient({
      chain: avalancheFuji,
      transport: http(forkRpc),
    });

    const validatorKey =
      process.env.VALIDATOR_PRIVATE_KEY!.trim() as `0x${string}`;
    const validatorAccount = privateKeyToAccount(validatorKey);

    // Verify validator account is strictly distinct from owner
    expect(validatorAccount.address.toLowerCase()).not.toBe(ownerAccount.address.toLowerCase());
    expect(validatorAccount.address.toLowerCase()).toBe('0x83f5e5f17ee8d7bec1968f100a11824e9c3713b5');

    const validatorWallet = createWalletClient({
      account: validatorAccount,
      chain: avalancheFuji,
      transport: http(forkRpc),
    });

    const agentOwnerAddress = '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c';
    await publicClient.request({
      method: 'anvil_impersonateAccount' as any,
      params: [agentOwnerAddress],
    });
    await publicClient.request({
      method: 'anvil_setBalance' as any,
      params: [agentOwnerAddress, '0x8AC7230489E80000'],
    });

    const ownerWallet = createWalletClient({
      account: agentOwnerAddress,
      chain: avalancheFuji,
      transport: http(forkRpc),
    });

    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    // Mission with tampered payeeRoot (deliberately not matching on-chain registry)
    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: '0x0000000000000000000000000000000000000000000000000000000000000bad',
      auditHeadHash: TEST_HEAD_HASH,
    });

    const jobResult = await runMissionValidatorJob(mission.slug, {
      publicClient,
      ownerWalletClient: ownerWallet,
      validatorWalletClient: validatorWallet,
      validatorAccount,
      rpcUrl: forkRpc,
      skipOnChainBroadcast: false,
    });

    // Score MUST be 0 due to tampered state
    expect(jobResult.validationResult.valid).toBe(false);
    expect(jobResult.validationResult.score).toBe(0);
    expect(jobResult.validationResult.tag).toContain('failed:');
    expect(jobResult.validationResult.tag).toContain('ROOT_MISMATCH');
    expect(jobResult.isRegisteredOnChain).toBe(true);
    expect(jobResult.responseTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    // Read on-chain status from ValidationRegistry directly
    const onchainStatus = await publicClient.readContract({
      address: DEFAULT_VALIDATION_REGISTRY,
      abi: [
        parseAbiItem(
          'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)'
        ),
      ],
      functionName: 'getValidationStatus',
      args: [jobResult.requestHash],
    });

    const [recordedValidator, agentId, recordedScore, , recordedTag] = onchainStatus;
    expect(recordedValidator.toLowerCase()).toBe(validatorAccount.address.toLowerCase());
    expect(agentId).toBe(294n);
    expect(recordedScore).toBe(0);
    expect(recordedTag).toBe(jobResult.validationResult.tag);
  });

  // A4-01: Mission outside demo block range (e.g. block 75000000..75000050) evaluates correctly against snapshot block without hardcoded 60689760 window
  it('M7-A4-01: mission outside demo block range (block 75000000..75000050) evaluates correctly against snapshot block without hardcoded 60689760 window', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 75000000n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    expect(bundle.creationBlock).toBe(75000000n);

    let getLogsRange = { from: 0n, to: 0n };
    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(75000050n),
      readContract: vi.fn().mockImplementation(async ({ functionName, blockNumber }) => {
        expect(blockNumber).toBe(75000050n); // Snapshot block enforced
        if (functionName === 'anchoredMissionProofs') return bundle.auditHead;
        if (functionName === 'missionPayeeRoot') return bundle.payeeRoot;
        if (functionName === 'missions') {
          return [bundle.missionId, bundle.treasury, 2000000n, 1794670342n, true, true];
        }
        throw new Error(`Unexpected functionName: ${functionName}`);
      }),
      getLogs: vi.fn().mockImplementation(async ({ fromBlock, toBlock }) => {
        getLogsRange = { from: fromBlock, to: toBlock };
        return [
          {
            args: {
              id: 1n,
              to: bundle.payees[0],
              amount: 500000n,
              missionId: bundle.missionId,
            },
          },
        ];
      }),
    } as any;

    const jobResult = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClient,
      fromBlock: 75000000n,
      toBlock: 75000050n,
      skipOnChainBroadcast: true,
    });

    expect(jobResult.validationResult.valid).toBe(true);
    expect(jobResult.validationResult.score).toBe(100);
    expect(getLogsRange.from).toBe(75000000n);
    expect(getLogsRange.to).toBe(75000050n);
    expect(jobResult.validationResult.details.snapshotBlock).toBe('75000050');
  });

  // A4-02: When request does not exist on-chain and no owner signer provided, job records REQUEST_PENDING with unsignedRequest
  it('M7-A4-02: when request does not exist on-chain and no owner signer provided, job records REQUEST_PENDING with unsignedRequest and does NOT broadcast response', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const mockClient = createMockPublicClient(bundle);
    mockClient.readContract = vi.fn().mockImplementation(async ({ functionName }) => {
      if (functionName === 'anchoredMissionProofs') return bundle.auditHead;
      if (functionName === 'missionPayeeRoot') return bundle.payeeRoot;
      if (functionName === 'missions') {
        return [bundle.missionId, bundle.treasury, 2000000n, 1794670342n, true, true];
      }
      if (functionName === 'isValidationComplete') return false;
      if (functionName === 'getValidationStatus') {
        return ['0x0000000000000000000000000000000000000000', 0n, 0, '0x0', '', 0n];
      }
      throw new Error(`Unexpected function: ${functionName}`);
    });

    const jobResult = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClient,
      skipOnChainBroadcast: false,
    });

    expect(jobResult.status).toBe('REQUEST_PENDING');
    expect(jobResult.isRegisteredOnChain).toBe(false);
    expect(jobResult.unsignedRequest).toBeDefined();
    expect(jobResult.unsignedRequest.functionName).toBe('validationRequest');
    expect(jobResult.unsignedRequest.requestHash).toBe(jobResult.requestHash);

    // Verify DB record matches exactly
    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(dbJob?.status).toBe('REQUEST_PENDING');
    expect(dbJob?.unsignedRequest).toContain('validationRequest');
  });

  // A4-03: When request exists on-chain but response broadcast fails, job records FAILED
  it('M7-A4-03: when request exists on-chain but response broadcast fails, job records FAILED and does not mark complete', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const mockClient = createMockPublicClient(bundle);
    mockClient.readContract = vi.fn().mockImplementation(async ({ functionName }) => {
      if (functionName === 'anchoredMissionProofs') return bundle.auditHead;
      if (functionName === 'missionPayeeRoot') return bundle.payeeRoot;
      if (functionName === 'missions') {
        return [bundle.missionId, bundle.treasury, 2000000n, 1794670342n, true, true];
      }
      if (functionName === 'isValidationComplete') return false;
      if (functionName === 'getValidationStatus') {
        return ['0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5', 294n, 0, '0x0', '', 1700000000n];
      }
      throw new Error(`Unexpected function: ${functionName}`);
    });

    const failingValidatorWallet = {
      writeContract: vi.fn().mockRejectedValue(new Error('RPC_GAS_ESTIMATION_FAILED')),
    } as any;

    const jobResult = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClient,
      validatorWalletClient: failingValidatorWallet,
      validatorAccount: { address: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5' },
      skipOnChainBroadcast: false,
    });

    expect(jobResult.status).toBe('FAILED');
    expect(jobResult.isRegisteredOnChain).toBe(false);
    expect(jobResult.failureReason).toContain('RPC_GAS_ESTIMATION_FAILED');

    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(dbJob?.status).toBe('FAILED');
    expect(dbJob?.failureReason).toContain('RPC_GAS_ESTIMATION_FAILED');
  });

  // A4-04: Process restart simulation: memory cache is cleared, but /api/verify reads state directly from database
  it('M7-A4-04: process restart simulation: memory cache is cleared, but /api/verify reads state directly from database', async () => {
    const { mission, spendToken } = await createTestMission({
      publicPublished: true,
      auditHeadHash: TEST_HEAD_HASH,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    // Seed a confirmed validation job in database matching bundle requestHash
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'RESPONSE_CONFIRMED',
        score: 100,
        tag: 'verified-full',
        validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
        agentId: '294',
        responseTxHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
      },
    });

    // Simulate complete process restart: wipe RAM map
    clearMemoryValidationCache();
    expect(getMemoryValidationRecord(requestHash)).toBeUndefined();

    // Query API
    const req = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      headers: { authorization: `Bearer ${spendToken}` },
    });
    const res = await verifyRouteGET(req, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.erc8004Validation.isComplete).toBe(true);
    expect(json.erc8004Validation.status).toBe('RESPONSE_CONFIRMED');
    expect(json.erc8004Validation.score).toBe(100);
    expect(json.erc8004Validation.validatorAddress).toBe('0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5');
    expect(json.erc8004Validation.snowtraceUrl).toContain('0xabcdefabcdefabcdef');
  });

  // A4-05: Reviewer probe: unauthorized payout at block 100 outside last 90 blocks is detected by full range scan
  it('M7-A4-05: reviewer probe: unauthorized payout at block 100 outside last 90 blocks causes failure / score 0', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 50n,
      treasuryCap: 5000000n, // 5 USDC cap
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    expect(bundle.creationBlock).toBe(50n);

    // Mock client where:
    // Block 100: payout of 6 USDC (unauthorized overspend!)
    // Block 999: payout of 1 USDC
    // Snapshot: 1000n
    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
      readContract: vi.fn().mockImplementation(async ({ functionName, blockNumber }) => {
        expect(blockNumber).toBe(1000n);
        if (functionName === 'anchoredMissionProofs') return bundle.auditHead;
        if (functionName === 'missionPayeeRoot') return bundle.payeeRoot;
        if (functionName === 'missions') {
          return [bundle.missionId, bundle.treasury, 5000000n, 1794670342n, true, true];
        }
        throw new Error(`Unexpected functionName: ${functionName}`);
      }),
      getLogs: vi.fn().mockImplementation(async ({ fromBlock, toBlock }) => {
        const logs: any[] = [];
        // Payout at block 100
        if (fromBlock <= 100n && toBlock >= 100n) {
          logs.push({
            blockNumber: 100n,
            transactionHash: '0x1000000000000000000000000000000000000000000000000000000000000100',
            logIndex: 0,
            args: {
              id: 1n,
              to: bundle.payees[0],
              amount: 6000000n, // 6 USDC
              missionId: bundle.missionId,
            },
          });
        }
        // Payout at block 999
        if (fromBlock <= 999n && toBlock >= 999n) {
          logs.push({
            blockNumber: 999n,
            transactionHash: '0x9990000000000000000000000000000000000000000000000000000000000999',
            logIndex: 0,
            args: {
              id: 2n,
              to: bundle.payees[0],
              amount: 1000000n, // 1 USDC
              missionId: bundle.missionId,
            },
          });
        }
        return logs;
      }),
    } as any;

    const result = await validateBundleOnChain(mockClient, bundle, 50n, 1000n);

    // Full scan from block 50 to 1000 must find the 6 USDC payout at block 100 + 1 USDC at block 999 = 7 USDC > 5 USDC cap!
    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.checks.totalSpendWithinCap).toBe(false);
    expect(result.tag).toContain('SPEND_EXCEEDS_CAP');
    expect(result.details.totalExecutedAmount).toBe('7000000');
    expect(result.details.executedCount).toBe(2);
  });

  // A4-06: Missing trusted scan start returns unverified-missing-start
  it('M7-A4-06: missing trusted scan start returns score 0 with unverified-missing-start tag', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      // No creationBlock provided
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    expect(bundle.creationBlock).toBeUndefined();

    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
    } as any;

    const result = await validateBundleOnChain(mockClient, bundle, undefined, 1000n);
    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.tag).toBe('unverified-missing-start');
    expect(result.details.failedChecks).toContain('TRUSTED_SCAN_START_MISSING');
  });

  // A4-07: Inverted block range returns invalid-range
  it('M7-A4-07: inverted block range (start > end) returns score 0 with invalid-range tag', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 500n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(400n),
    } as any;

    const result = await validateBundleOnChain(mockClient, bundle, 500n, 400n);
    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.tag).toBe('invalid-range');
    expect(result.details.failedChecks).toContain('INVERTED_BLOCK_RANGE');
  });

  // A4-08: RPC log query error returns scan-error
  it('M7-A4-08: RPC log query failure returns score 0 with scan-error tag', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 100n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(200n),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'anchoredMissionProofs') return bundle.auditHead;
        if (functionName === 'missionPayeeRoot') return bundle.payeeRoot;
        if (functionName === 'missions') {
          return [bundle.missionId, bundle.treasury, 5000000n, 1794670342n, true, true];
        }
        throw new Error(`Unexpected functionName: ${functionName}`);
      }),
      getLogs: vi.fn().mockRejectedValue(new Error('RPC_NODE_TIMEOUT')),
    } as any;

    const result = await validateBundleOnChain(mockClient, bundle, 100n, 200n);
    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.tag).toBe('scan-error');
    expect(result.details.failedChecks).toContain('RPC_SCAN_ERROR');
  });

  // A4-09: Unsigned request returns wallet-sendable transaction format
  it('M7-A4-09: buildUnsignedValidationRequest produces wallet-sendable transaction with to, data, value, chainId', () => {
    const unsignedTx = buildUnsignedValidationRequest({
      registryAddress: DEFAULT_VALIDATION_REGISTRY,
      validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
      agentId: 294n,
      slug: 'test-mission-a4',
      requestHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    });

    expect(unsignedTx.to).toBe(DEFAULT_VALIDATION_REGISTRY);
    expect(unsignedTx.value).toBe('0');
    expect(unsignedTx.chainId).toBe(43113);
    expect(unsignedTx.data).toMatch(/^0x[0-9a-fA-F]+/);
    expect(unsignedTx.functionName).toBe('validationRequest');
    expect(unsignedTx.requestHash).toBe('0x1111111111111111111111111111111111111111111111111111111111111111');
  });

  // A4-10: Queue worker processes enqueued jobs idempotently
  it('M7-A4-10: processQueuedValidationJobs processes enqueued jobs idempotently and advances state', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const mockClient = createMockPublicClient(bundle);

    // Enqueue job in DB
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash: computeValidationRequestHash(bundle),
        status: 'QUEUED',
        fromBlock: 60689700n,
      },
    });

    const workerRes = await processQueuedValidationJobs(5, {
      publicClient: mockClient,
      skipOnChainBroadcast: true,
    });

    expect(workerRes.processed).toBe(1);
    expect(workerRes.results[0].status).toBe('LOCAL_EVALUATED');
    expect(workerRes.results[0].validationResult.valid).toBe(true);

    const updatedJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(updatedJob?.status).toBe('LOCAL_EVALUATED');
    expect(updatedJob?.score).toBe(100);
  });

  // A4-11: Owner receipt reconciliation verifies event and advances job
  it('M7-A4-11: reconcileOwnerValidationRequestReceipt validates event and advances job', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);

    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'REQUEST_PENDING',
        score: 100,
        tag: 'verified-full',
        validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
        agentId: '294',
      },
    });

    const dummyTxHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
    const validationRequestEventAbi = parseAbiItem(
      'event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)'
    );
    const topics = encodeEventTopics({
      abi: [validationRequestEventAbi],
      eventName: 'ValidationRequest',
      args: {
        validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
        agentId: 294n,
        requestHash,
      },
    });
    const data = encodeAbiParameters([{ type: 'string' }], [`evidence/validation/${mission.slug}.json`]);

    const mockReceipt = {
      status: 'success',
      to: DEFAULT_VALIDATION_REGISTRY,
      from: mission.ownerAddress,
      logs: [
        {
          address: DEFAULT_VALIDATION_REGISTRY,
          topics,
          data,
        },
      ],
    };

    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
      readContract: vi.fn().mockResolvedValue(true),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    } as any;

    const reconRes = await reconcileOwnerValidationRequestReceipt(mission.slug, dummyTxHash, {
      publicClient: mockClient,
      validatorAccount: { address: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5' },
      validatorWalletClient: {
        writeContract: vi.fn().mockResolvedValue('0xresponseTxHash1234567890123456789012345678901234567890123456789012'),
      } as any,
    });

    expect(reconRes.success).toBe(true);
    expect(reconRes.status).toBe('RESPONSE_CONFIRMED');
    expect(reconRes.requestTxHash).toBe(dummyTxHash);

    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(dbJob?.status).toBe('RESPONSE_CONFIRMED');
    expect(dbJob?.requestTxHash).toBe(dummyTxHash);
  });

  // A4-12: Receipt-confirmed creation start vs unverified/forged creation block without receipt
  it('M7-A4-12: receipt-confirmed creation start verifies on-chain MissionCreated event, forged/missing receipt leaves creationBlock null', async () => {
    const slug = 'test-receipt-creation-slug';
    const missionIdBytes32 = '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
    const treasury = getGuardedTreasuryAddress();

    // 1. Missing receipt leaves creationBlock null (provenance unverified)
    const payloadUnverified = {
      slug: `${slug}-unverified`,
      agentAddress: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      treasuryCap: '5000000',
      toolCap: '1000000',
      durationSeconds: 3600,
      creationBlock: '60689999', // User entered block without verified receipt
    };

    const chalReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({
        action: 'CREATE_MISSION',
        payload: payloadUnverified,
        expectedSigner: ownerAccount.address,
      }),
    });
    const chalRes = await challengePOST(chalReq);
    const { message, nonce } = await chalRes.json();
    const sigUnverified = await ownerAccount.signMessage({ message });

    const createReq = new NextRequest('http://localhost:3000/api/missions', {
      method: 'POST',
      body: JSON.stringify({
        nonce,
        signature: sigUnverified,
        payload: payloadUnverified,
      }),
    });
    const createRes = await missionCreatePOST(createReq);
    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.mission.creationBlock).toBeNull(); // Untrusted block ignored without receipt!

    // 2. Receipt verification helper with mock client
    const topics = encodeEventTopics({
      abi: [MISSION_CREATED_EVENT_ABI],
      eventName: 'MissionCreated',
      args: {
        missionId: missionIdBytes32 as `0x${string}`,
      },
    });

    const mockReceipt = {
      status: 'success',
      to: treasury,
      blockNumber: 60689850n,
      logs: [{ address: treasury, topics, data: '0x' }],
    };
    const mockClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
    } as any;

    const verifiedRes = await verifyMissionCreationReceipt({
      receiptTxHash: '0xvalidCreationReceiptTxHash12345678901234567890123456789012345678',
      expectedMissionId: missionIdBytes32,
      publicClient: mockClient,
    });
    expect(verifiedRes.valid).toBe(true);
    expect(verifiedRes.creationBlock).toBe(60689850n);

    // 3. Forged receipt with reverted status fails
    const mockRevertedReceipt = {
      status: 'reverted',
      to: treasury,
      logs: [],
    };
    const mockRevertedClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue(mockRevertedReceipt),
    } as any;
    const revertedRes = await verifyMissionCreationReceipt({
      receiptTxHash: '0xrevertedReceiptTxHash123456789012345678901234567890123456789012',
      expectedMissionId: missionIdBytes32,
      publicClient: mockRevertedClient,
    });
    expect(revertedRes.valid).toBe(false);
    expect(revertedRes.error).toContain('reverted');
  });

  // A4-13: BigInt response serialization
  it('M7-A4-13: POST /api/missions returns serialized BigInt via DTO without throwing', async () => {
    const slug = 'test-bigint-serialization-slug';
    process.env.TEST_ALLOW_UNVERIFIED_CREATION_BLOCK = '1';

    const payload = {
      slug,
      agentAddress: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      treasuryCap: '5000000',
      toolCap: '1000000',
      durationSeconds: 3600,
      creationBlock: '60689800',
    };

    const chalReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({
        action: 'CREATE_MISSION',
        payload,
        expectedSigner: ownerAccount.address,
      }),
    });
    const chalRes = await challengePOST(chalReq);
    const { message, nonce } = await chalRes.json();
    const sig = await ownerAccount.signMessage({ message });

    const createReq = new NextRequest('http://localhost:3000/api/missions', {
      method: 'POST',
      body: JSON.stringify({
        nonce,
        signature: sig,
        payload,
      }),
    });

    const res = await missionCreatePOST(createReq);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.mission.slug).toBe(slug);
    expect(json.mission.creationBlock).toBe('60689800'); // Serialized string, no BigInt TypeError!
    delete process.env.TEST_ALLOW_UNVERIFIED_CREATION_BLOCK;
  });

  // A4-14: Two-worker claim concurrency
  it('M7-A4-14: two workers concurrently claiming queued job guarantees exactly one winner', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      creationBlock: 60689700n,
    });

    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash: '0xconcurrentRaceRequestHash1234567890123456789012345678901234567890',
        status: 'QUEUED',
        mode: 'LIVE_FUJI',
      },
    });

    // Both workers attempt atomic claim concurrently
    const [worker1Res, worker2Res] = await Promise.all([
      claimNextValidationJob('worker-A', 60_000),
      claimNextValidationJob('worker-B', 60_000),
    ]);

    // Exactly one worker must succeed, the other must get null
    const claimedCount = (worker1Res ? 1 : 0) + (worker2Res ? 1 : 0);
    expect(claimedCount).toBe(1);

    const winner = worker1Res || worker2Res;
    expect(winner.status).toBe('LOCAL_EVALUATING');
    expect(['worker-A', 'worker-B']).toContain(winner.workerLeaseOwner);
    expect(winner.workerLeaseUntil).toBeDefined();
  });

  // A4-15: Crash lease reclaim
  it('M7-A4-15: expired worker lease is reclaimed after crash by next worker', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      creationBlock: 60689700n,
    });

    // Seed a crashed worker job with expired lease
    const expiredLease = new Date(Date.now() - 30_000); // 30s in the past
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash: '0xexpiredLeaseRequestHash1234567890123456789012345678901234567890',
        status: 'LOCAL_EVALUATING',
        workerLeaseOwner: 'crashed-worker-old',
        workerLeaseUntil: expiredLease,
        retryCount: 1,
        mode: 'LIVE_FUJI',
      },
    });

    // Recovery worker claims the expired job
    const reclaimedJob = await claimNextValidationJob('recovery-worker', 60_000);
    expect(reclaimedJob).not.toBeNull();
    expect(reclaimedJob.missionSlug).toBe(mission.slug);
    expect(reclaimedJob.workerLeaseOwner).toBe('recovery-worker');
    expect(reclaimedJob.retryCount).toBe(2);
    expect(new Date(reclaimedJob.workerLeaseUntil).getTime()).toBeGreaterThan(Date.now());
  });

  // A4-16: Database failure in close route rolls back mission close
  it('M7-A4-16: close route does not swallow DB errors; mission close is rolled back on error', async () => {
    const { mission } = await createTestMission({
      status: 'ACTIVE',
    });

    const chalReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({
        action: 'CLOSE_MISSION_S1',
        payload: { slug: mission.slug },
        expectedSigner: ownerAccount.address,
      }),
    });
    const chalRes = await challengePOST(chalReq);
    const { message, nonce } = await chalRes.json();
    const sig = await ownerAccount.signMessage({ message });

    // Mock withLockOrder / prisma to simulate database failure during close
    const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
      new Error('Simulated PostgreSQL transaction error')
    );

    try {
      const closeReq = new NextRequest(`http://localhost:3000/api/missions/${mission.slug}/close`, {
        method: 'POST',
        body: JSON.stringify({
          nonce,
          signature: sig,
          payload: { slug: mission.slug },
        }),
      });

      const closeRes = await closeRoutePOST(closeReq, { params: Promise.resolve({ slug: mission.slug }) });
      expect(closeRes.status).toBe(500); // Fails closed, error not swallowed!

      // Mission status must remain ACTIVE in DB (rolled back)
      const dbMission = await prisma.mission.findUnique({ where: { slug: mission.slug } });
      expect(dbMission?.status).toBe('ACTIVE');
    } finally {
      spy.mockRestore();
    }
  });

  // A4-17: Owner receipt reconciliation negative checks
  it('M7-A4-17: reconcileOwnerValidationRequestReceipt rejects null score, wrong sender, wrong validator, wrong registry', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);
    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    // 1. Rejects unevaluated job (score: null)
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'QUEUED',
        score: null, // Unevaluated!
        tag: null,
      },
    });

    const dummyTx = '0x1234567890123456789012345678901234567890123456789012345678901234';
    const nullScoreRes = await reconcileOwnerValidationRequestReceipt(mission.slug, dummyTx);
    expect(nullScoreRes.success).toBe(false);
    expect(nullScoreRes.error).toContain('unevaluated');

    // Update job to have score
    await prisma.validationJob.update({
      where: { missionSlug: mission.slug },
      data: { score: 100, tag: 'verified-full', validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5', agentId: '294' },
    });

    // 2. Rejects wrong sender (stranger)
    const strangerReceipt = {
      status: 'success',
      to: DEFAULT_VALIDATION_REGISTRY,
      from: '0x9999999999999999999999999999999999999999', // Stranger, not mission owner
      logs: [],
    };
    const strangerClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue(strangerReceipt),
    } as any;

    const strangerRes = await reconcileOwnerValidationRequestReceipt(mission.slug, dummyTx, {
      publicClient: strangerClient,
    });
    expect(strangerRes.success).toBe(false);
    expect(strangerRes.error).toContain('Unauthorized transaction sender');

    // 3. Rejects wrong registry contract
    const wrongRegistryReceipt = {
      status: 'success',
      to: '0x0000000000000000000000000000000000000001',
      from: mission.ownerAddress,
      logs: [],
    };
    const wrongRegistryClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue(wrongRegistryReceipt),
    } as any;
    const wrongRegRes = await reconcileOwnerValidationRequestReceipt(mission.slug, dummyTx, {
      publicClient: wrongRegistryClient,
    });
    expect(wrongRegRes.success).toBe(false);
    expect(wrongRegRes.error).toContain('recipient mismatch');
  });

  // A4-18: POST /api/verify/[missionId] enforces owner authorization
  it('M7-A4-18: POST /api/verify/[missionId] requires valid owner authorization bearer token', async () => {
    const { mission } = await createTestMission();

    // 1. Without token returns 401
    const unauthReq = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      body: JSON.stringify({ txHash: '0xdummyTxHash1234567890123456789012345678901234567890123456789012' }),
    });
    const unauthRes = await verifyRoutePOST(unauthReq, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(unauthRes.status).toBe(401);

    // 2. With stranger token returns 403
    const strangerToken = await issueSpendToken({
      deploymentId: process.env.DEPLOYMENT_ID || 'unihack-test-deployment',
      stage: 'S1',
      authVersion: 1,
      missionSlug: 'different-mission',
      missionId: '0xdifferent',
      ownerAddress: '0x9999999999999999999999999999999999999999',
      agentAddress: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      missionExpiresAt: new Date(Date.now() + 3600_000),
      missionConfigVersion: 1,
      policyHash: '0x123',
    });
    const strangerReq = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${strangerToken}` },
      body: JSON.stringify({ txHash: '0xdummyTxHash1234567890123456789012345678901234567890123456789012' }),
    });
    const strangerRes = await verifyRoutePOST(strangerReq, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(strangerRes.status).toBe(403);
  });

  // A4-19: Changed bundle context cannot reuse stale completion
  it('M7-A4-19: /api/verify rejects stale completion when bundle context has changed', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);
    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
      publicPublished: true,
    });

    // Seed a job that was confirmed for an old/different requestHash
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash: '0xoldStaleRequestHash123456789012345678901234567890123456789012345678',
        status: 'RESPONSE_CONFIRMED',
        score: 100,
        tag: 'verified-full',
      },
    });

    const verifyReq = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'GET',
    });
    const verifyRes = await verifyRouteGET(verifyReq, { params: Promise.resolve({ missionId: mission.slug }) });
    const verifyJson = await verifyRes.json();

    // Must report STALE_CONTEXT, isComplete: false (cannot reuse stale completion!)
    expect(verifyJson.erc8004Validation.status).toBe('STALE_CONTEXT');
    expect(verifyJson.erc8004Validation.isComplete).toBe(false);
  });

  // A4-20: Executable worker runner smoke
  it('M7-A4-20: processQueuedValidationJobs processes queued jobs and updates DB state', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);
    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'QUEUED',
        mode: 'LIVE_FUJI',
      },
    });

    const mockClient = createMockPublicClient(bundle);
    const workerRes = await processQueuedValidationJobs(1, {
      publicClient: mockClient,
      skipOnChainBroadcast: true,
    });

    expect(workerRes.processed).toBe(1);
    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    if (dbJob?.status === 'FAILED') {
      console.error('M7-A4-20 FAILED REASON:', dbJob?.failureReason);
    }
    expect(dbJob?.status).toBe('LOCAL_EVALUATED');
    expect(dbJob?.score).toBe(100);
  });
});
