import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  encodeEventTopics,
  encodeAbiParameters,
  parseTransaction,
  keccak256,
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
  reconcileMissionCreationReceipt,
  buildUnsignedValidationRequest,
  verifyMissionCreationReceipt,
  setMemoryValidationRecord,
  serializeWithBigInt,
  MISSION_CREATED_EVENT_ABI,
  VALIDATION_RESPONSE_EVENT_ABI,
  DEFAULT_VALIDATION_REGISTRY,
  verifyStrictChainResponse,
  renewJobLease,
  advanceValidationJob,
  buildFrozenValidationContext,
} from '@/lib/validator-job';
import { POST as creationReceiptPOST } from '@/app/api/missions/[slug]/creation-receipt/route';
import { getPasskeyAuthorityAddress } from '@/lib/config';
import { computeValidationRequestHash, validateBundleOnChain } from '@/lib/validation-bundle';
import { computePayeeMerkleTree } from '@/lib/merkle';
import { POST as missionCreatePOST } from '@/app/api/missions/route';
import { POST as closeRoutePOST } from '@/app/api/missions/[slug]/close/route';
import { POST as challengePOST } from '@/app/api/auth/challenge/route';
import { GET as verifyRouteGET, POST as verifyRoutePOST } from '@/app/api/verify/[missionId]/route';
import { setAnchorFetcherForTesting, getGuardedTreasuryAddress } from '@/lib/config';
import { issueSpendToken, issueReadToken } from '@/lib/auth';

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
      getChainId: vi.fn().mockResolvedValue(43113),
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
    const { mission: missionB } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
    });
    const bundleB = await buildMissionValidationBundle(missionB.slug);
    const mockClientRootMismatch = createMockPublicClient(bundleB, { rootMatches: false });
    const resultRootMismatch = await runMissionValidatorJob(missionB.slug, {
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
    expect(unsignedTx.value).toBe('0x0');
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
    const testResponseHash = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const frozenCtx = buildFrozenValidationContext({
      bundle,
      ownerAddress: mission.ownerAddress,
      validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
      agentId: '294',
    });
    frozenCtx.evidence = {
      evaluatedAt: new Date().toISOString(),
      responseJsonString: '{}',
      responseHash: testResponseHash,
      score: 100,
      tag: 'verified-full',
      checks: {},
      details: {},
    };

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
        frozenContext: serializeWithBigInt(frozenCtx),
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
      getChainId: vi.fn().mockResolvedValue(43113),
      getTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [
            '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
            294n,
            100,
            testResponseHash,
            'verified-full',
            1700000000n,
          ];
        }
        return true;
      }),
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
      getChainId: vi.fn().mockResolvedValue(43113),
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
      getChainId: vi.fn().mockResolvedValue(43113),
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
      getChainId: vi.fn().mockResolvedValue(43113),
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
      getChainId: vi.fn().mockResolvedValue(43113),
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

  // A4-21: UNKNOWN response cannot double-send: writeContract is called at most once across timeout + restart + repeated POST
  it('M7-A4-21: UNKNOWN response cannot double-send: writeContract is called at most once across timeout + restart + repeated POST', async () => {
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
    const testResponseHash = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const frozenCtx = buildFrozenValidationContext({
      bundle,
      ownerAddress: mission.ownerAddress,
      validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
      agentId: '294',
    });
    frozenCtx.evidence = {
      evaluatedAt: new Date().toISOString(),
      responseJsonString: '{}',
      responseHash: testResponseHash,
      score: 100,
      tag: 'verified-full',
      checks: {},
      details: {},
    };

    // Initial job in RESPONSE_PENDING with score already evaluated
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'RESPONSE_PENDING',
        score: 100,
        tag: 'verified-full',
        frozenContext: serializeWithBigInt(frozenCtx),
      },
    });

    let writeContractCallCount = 0;
    const mockValidatorWallet = {
      writeContract: vi.fn().mockImplementation(async () => {
        writeContractCallCount++;
        return '0xfirstResponseTxHash1234567890123456789012345678901234567890123456789012';
      }),
    } as any;

    // Public client simulating transaction pending in mempool (receipt not mined yet on first call)
    let receiptMined = false;
    const mockPublicClient = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return receiptMined;
        if (functionName === 'getValidationStatus') {
          return ['0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5', 294n, 100, testResponseHash, 'verified-full', 1700000000n];
        }
        return true;
      }),
      getTransactionReceipt: vi.fn().mockImplementation(async () => {
        if (!receiptMined) return null; // Still pending in mempool!
        return { status: 'success', blockNumber: 60689900n };
      }),
      waitForTransactionReceipt: vi.fn().mockImplementation(async () => {
        if (!receiptMined) return null; // Timeout!
        return { status: 'success', blockNumber: 60689900n };
      }),
    } as any;

    // Call 1: Initiates broadcast. waitForTransactionReceipt times out (returns null).
    const call1Result = await runMissionValidatorJob(mission.slug, {
      publicClient: mockPublicClient,
      validatorWalletClient: mockValidatorWallet,
      validatorAccount: { address: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5' },
      skipOnChainBroadcast: false,
    });

    expect(call1Result.status).toBe('RESPONSE_PENDING');
    expect(call1Result.responseTxHash).toBeDefined();
    expect(call1Result.responseTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(writeContractCallCount).toBe(1);

    // Call 2: Retry / restart while still pending. Must NOT call writeContract again!
    const call2Result = await runMissionValidatorJob(mission.slug, {
      publicClient: mockPublicClient,
      validatorWalletClient: mockValidatorWallet,
      validatorAccount: { address: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5' },
      skipOnChainBroadcast: false,
    });

    expect(call2Result.status).toBe('RESPONSE_PENDING');
    expect(call2Result.responseTxHash).toBe(call1Result.responseTxHash);
    expect(writeContractCallCount).toBe(1); // ZERO double-spend!

    // Call 3: Receipt is now mined on chain. Reconcile completes.
    receiptMined = true;
    const call3Result = await runMissionValidatorJob(mission.slug, {
      publicClient: mockPublicClient,
      validatorWalletClient: mockValidatorWallet,
      validatorAccount: { address: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5' },
      skipOnChainBroadcast: false,
    });

    expect(call3Result.status).toBe('RESPONSE_CONFIRMED');
    expect(call3Result.isRegisteredOnChain).toBe(true);
    expect(writeContractCallCount).toBe(1); // STILL exactly 1 call across all retries!
  });

  // A4-22: Exact chain response: stored local 100 vs actual chain 37 displays/persists 37 as chainScore, with local 100 separately
  it('M7-A4-22: Exact chain response: stored local 100 vs actual chain 37 displays/persists 37 as chainScore, with local 100 separately', async () => {
    const payees = ['0x1111111111111111111111111111111111111111'];
    const tree = computePayeeMerkleTree(payees);
    const { mission } = await createTestMission({
      payeesJson: JSON.stringify(payees),
      payeeRoot: tree.root,
      auditHeadHash: TEST_HEAD_HASH,
      creationBlock: 60689700n,
      publicPublished: true,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    // Pre-seed job with local score 100
    const localEval = {
      valid: true,
      score: 100,
      tag: 'verified-full',
      checks: { headMatchesOnChain: true, rootMatchesOnChain: true, payeesGenerateRoot: true, executedPayeesValid: true, totalSpendWithinCap: true, hasExecutions: true },
      details: {},
    };
    const testRespHash = '0x3333333333333333333333333333333333333333333333333333333333333333';
    const frozenCtx = buildFrozenValidationContext({
      bundle,
      ownerAddress: mission.ownerAddress,
      validatorAddress: '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5',
      agentId: '294',
    });
    frozenCtx.evidence = {
      evaluatedAt: new Date().toISOString(),
      responseJsonString: '{}',
      responseHash: testRespHash,
      score: 100,
      tag: 'verified-full',
      checks: {},
      details: {},
    };

    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'LOCAL_EVALUATED',
        score: 100,
        tag: 'verified-full',
        evaluationResult: serializeWithBigInt(localEval),
        frozenContext: serializeWithBigInt(frozenCtx),
      },
    });

    // Mock registry returning actual chain score 37 and chain tag 'partial-override'
    const mockClient = createMockPublicClient(bundle);
    mockClient.readContract = vi.fn().mockImplementation(async ({ functionName }) => {
      if (functionName === 'anchoredMissionProofs') return bundle.auditHead;
      if (functionName === 'missionPayeeRoot') return bundle.payeeRoot;
      if (functionName === 'missions') {
        return [bundle.missionId, bundle.treasury, 2000000n, 1794670342n, true, true];
      }
      if (functionName === 'isValidationComplete') return true;
      if (functionName === 'getValidationStatus') {
        return ['0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5', 294n, 37, testRespHash, 'partial-override', 1700000000n];
      }
      throw new Error(`Unexpected function: ${functionName}`);
    });

    const res = await runMissionValidatorJob(mission.slug, {
      publicClient: mockClient,
      skipOnChainBroadcast: false,
    });

    expect(res.status).toBe('RESPONSE_CONFIRMED');
    expect(res.chainScore).toBe(37);
    expect(res.chainTag).toBe('partial-override');

    // DB record must record chainScore 37 distinct from local score 100
    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(dbJob?.score).toBe(100); // Local evaluation score preserved
    expect(dbJob?.chainScore).toBe(37); // Actual chain score from registry
    expect(dbJob?.chainTag).toBe('partial-override');

    // GET /api/verify/[missionId] must reflect both
    const req = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`);
    const verifyRes = await verifyRouteGET(req, { params: Promise.resolve({ missionId: mission.slug }) });
    const verifyJson = await verifyRes.json();
    expect(verifyJson.erc8004Validation.score).toBe(37);
    expect(verifyJson.erc8004Validation.chainScore).toBe(37);
    expect(verifyJson.erc8004Validation.localScore).toBe(100);
    expect(verifyJson.erc8004Validation.tag).toBe('partial-override');
  });

  // A4-23: Passkey-authority creation receipt + treasury MissionCreated log succeeds
  it('M7-A4-23: Passkey-authority creation receipt + treasury MissionCreated log succeeds and reconciles creation block', async () => {
    const { mission, spendToken } = await createTestMission();

    const treasury = getGuardedTreasuryAddress().toLowerCase();
    const authority = getPasskeyAuthorityAddress().toLowerCase();

    const topics = encodeEventTopics({
      abi: [MISSION_CREATED_EVENT_ABI],
      eventName: 'MissionCreated',
      args: {
        missionId: mission.missionId as `0x${string}`,
      },
    });

    // Passkey route: transaction sent to authority, authority emits MissionCreated on treasury
    const passkeyReceipt = {
      status: 'success',
      to: authority, // Recipient is authority!
      blockNumber: 60689888n,
      logs: [{ address: treasury, topics, data: '0x' }], // Log emitted by treasury!
    };

    const mockClient = {
      getChainId: vi.fn().mockResolvedValue(43113),
      getTransactionReceipt: vi.fn().mockResolvedValue(passkeyReceipt),
    } as any;

    const receiptTxHash = '0xpasskeyCreationReceiptTxHash12345678901234567890123456789012345678';

    // 1. verifyMissionCreationReceipt accepts passkey authority recipient
    const verifiedRes = await verifyMissionCreationReceipt({
      receiptTxHash,
      expectedMissionId: mission.missionId,
      publicClient: mockClient,
    });
    expect(verifiedRes.valid).toBe(true);
    expect(verifiedRes.creationBlock).toBe(60689888n);

    // 2. Reconcile via POST /api/missions/[slug]/creation-receipt authenticated route
    const reconcileRes = await reconcileMissionCreationReceipt(mission.slug, receiptTxHash, {
      publicClient: mockClient,
    });
    expect(reconcileRes.success).toBe(true);
    expect(BigInt(reconcileRes.creationBlock!)).toBe(60689888n);

    const updatedMission = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(updatedMission?.creationBlock).toBe(60689888n);
    expect(updatedMission?.creationTxHash).toBe(receiptTxHash);
    expect(updatedMission?.creationProvenance).toBe('AUTHORITY_ROUTED_RECEIPT');
  });

  // A4-24: Database outage with warm memory cache returns 503 DATABASE_UNAVAILABLE
  it('M7-A4-24: Database outage with warm memory cache returns 503 DATABASE_UNAVAILABLE and cannot show complete', async () => {
    const { mission } = await createTestMission({
      publicPublished: true,
    });

    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    // Populate warm memory cache claiming complete
    setMemoryValidationRecord({
      requestHash,
      status: 'RESPONSE_CONFIRMED',
      score: 100,
      tag: 'verified-full',
      isRegisteredOnChain: true,
    });

    // Mock prisma failure simulating DB crash/outage
    const originalFindUnique = prisma.validationJob.findUnique;
    vi.spyOn(prisma.validationJob, 'findUnique').mockRejectedValue(new Error('DATABASE_OUTAGE_SIMULATED'));

    try {
      const req = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`);
      const res = await verifyRouteGET(req, { params: Promise.resolve({ missionId: mission.slug }) });

      // Must fail closed with 503 DATABASE_UNAVAILABLE: memory cache cannot bypass DB outage!
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('DATABASE_UNAVAILABLE');
    } finally {
      vi.spyOn(prisma.validationJob, 'findUnique').mockImplementation(originalFindUnique);
    }
  });

  // A4-25: POST /api/verify/[missionId] authorizes via fresh owner EIP-191 signature challenge
  it('M7-A4-25: POST /api/verify/[missionId] authorizes via fresh owner EIP-191 signature challenge', async () => {
    const { mission } = await createTestMission();
    const txHash = '0x1234567890123456789012345678901234567890123456789012345678901234';

    const chalReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({
        action: 'RECONCILE_VALIDATION_REQUEST',
        payload: { slug: mission.slug, txHash, chainId: 43113, targetMissionSlug: mission.slug },
        expectedSigner: ownerAccount.address,
      }),
    });
    const chalRes = await challengePOST(chalReq);
    expect(chalRes.status).toBe(200);
    const chalData = await chalRes.json();
    const challengeMessage = chalData.message || chalData.challenge?.message;
    const challengeNonce = chalData.nonce || chalData.challenge?.nonce;
    const signature = await ownerAccount.signMessage({ message: challengeMessage });

    const verifyReq = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      body: JSON.stringify({
        txHash,
        nonce: challengeNonce,
        signature,
        payload: { slug: mission.slug, txHash, chainId: 43113, targetMissionSlug: mission.slug },
      }),
    });

    const verifyRes = await verifyRoutePOST(verifyReq, { params: Promise.resolve({ missionId: mission.slug }) });
    // Must NOT be 401 or 403 (authorization succeeded!)
    expect(verifyRes.status).not.toBe(401);
    expect(verifyRes.status).not.toBe(403);
  });

  // A4-26: Mutate audit head or payee root after enqueue -> restart worker -> STALE_CONTEXT (no broadcast)
  it('M7-A4-26: Mutate audit head or payee root after enqueue -> restart worker -> STALE_CONTEXT (no broadcast)', async () => {
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

    // Enqueue job with frozen context
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'QUEUED',
        frozenContext: serializeWithBigInt(bundle),
      },
    });

    // Mutate auditHeadHash in mission table before worker runs
    await prisma.mission.update({
      where: { slug: mission.slug },
      data: { auditHeadHash: '0x0000000000000000000000000000000000000000000000000000000000000bad' },
    });

    const mockClient = createMockPublicClient(bundle);
    const workerRes = await processQueuedValidationJobs(1, {
      publicClient: mockClient,
      skipOnChainBroadcast: false,
    });

    expect(workerRes.processed).toBe(1);
    expect(workerRes.results[0].status).toBe('STALE_CONTEXT');
    expect(workerRes.results[0].failureReason).toContain('STALE_CONTEXT');

    const dbJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(dbJob?.status).toBe('STALE_CONTEXT');
    expect(dbJob?.failureReason).toContain('STALE_CONTEXT');
  });

  // A4-27: CLI process-validation-jobs reliability: dry-run on empty queue exits 0, failed job exits nonzero
  it('M7-A4-27: CLI process-validation-jobs: dry run on empty queue exits 0, and reports nonzero on job failure', async () => {
    const { execSync } = await import('child_process');
    const path = await import('path');
    const webDir = path.resolve(__dirname, '..');

    // 1. Dry run with empty queue -> exits 0 and logs properly
    const dryRunOutput = execSync('npx.cmd tsx scripts/process-validation-jobs.ts', {
      cwd: webDir,
      env: { ...process.env, WORKER_LIMIT: '5' },
      encoding: 'utf8',
    });
    expect(dryRunOutput).toContain('[Validator Worker] Starting process-once validation runner...');
    expect(dryRunOutput).toContain('Finished processing 0 job(s).');

    // 2. Injected failure in queue -> exits 1
    const { mission } = await createTestMission();
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        status: 'QUEUED',
        frozenContext: 'MALFORMED_JSON_INVALID_CONTEXT',
      },
    });

    let exitCode = 0;
    try {
      execSync('npx.cmd tsx scripts/process-validation-jobs.ts', {
        cwd: webDir,
        env: { ...process.env, WORKER_LIMIT: '1' },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err: any) {
      exitCode = err.status;
    }
    expect(exitCode).toBe(1);
  });

  // A4-28: Action-bound owner auth (unrelated challenge action, other mission slug, wrong txHash in payload, expired nonce, wrong-purpose token)
  it('M7-A4-28: Action-bound owner auth: rejects unrelated messages, expired nonces, wrong-purpose tokens, and mismatched payloads', async () => {
    const { mission } = await createTestMission();
    const dummyTx = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const systemState = await prisma.systemState.findUnique({ where: { id: 1 } });
    const currentDeploymentId = systemState?.deploymentId || 'dep-local';

    // 1. Missing auth header and signature -> 401
    const reqNoAuth = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      body: JSON.stringify({ txHash: dummyTx }),
    });
    const resNoAuth = await verifyRoutePOST(reqNoAuth, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(resNoAuth.status).toBe(401);

    // 2. Wrong-purpose token: execution session token (type: 'session') -> 403
    const sessionToken = await issueSpendToken({
      deploymentId: currentDeploymentId,
      stage: 'S1',
      authVersion: systemState?.authVersion || 1,
      missionSlug: mission.slug,
      missionId: mission.missionId,
      ownerAddress: mission.ownerAddress,
      agentAddress: mission.agentAddress,
      missionExpiresAt: new Date(Date.now() + 86400000),
      missionConfigVersion: 1,
      policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    });
    const reqSessionToken = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ txHash: dummyTx }),
    });
    const resSessionToken = await verifyRoutePOST(reqSessionToken, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(resSessionToken.status).toBe(403);
    const sessionData = await resSessionToken.json();
    expect(sessionData.error).toContain('execution token cannot authorize owner reconciliation');

    // 3. Token for different mission -> 403
    const otherMissionToken = await issueReadToken({
      deploymentId: currentDeploymentId,
      stage: 'S1',
      authVersion: systemState?.authVersion || 1,
      missionSlug: 'different-mission-slug',
      missionId: '0xdifferent0000000000000000000000000000000000000000000000000000000000',
      ownerAddress: mission.ownerAddress,
      agentAddress: mission.agentAddress,
      missionConfigVersion: 1,
      policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    });
    const reqOtherToken = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherMissionToken}` },
      body: JSON.stringify({ txHash: dummyTx }),
    });
    const resOtherToken = await verifyRoutePOST(reqOtherToken, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(resOtherToken.status).toBe(403);

    // 4. Server challenge with unrelated action (READ_MISSION) -> 400
    const readChalReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({
        action: 'READ_MISSION',
        expectedSigner: mission.ownerAddress,
        payload: { slug: mission.slug, targetMissionSlug: mission.slug },
      }),
    });
    const readChalRes = await challengePOST(readChalReq);
    const readChalData = await readChalRes.json();
    const readMessage = readChalData.message || readChalData.challenge?.message;
    const readNonce = readChalData.nonce || readChalData.challenge?.nonce;
    const readSig = await ownerAccount.signMessage({ message: readMessage });

    const reqWrongAction = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      body: JSON.stringify({
        txHash: dummyTx,
        nonce: readNonce,
        signature: readSig,
        payload: { slug: mission.slug, txHash: dummyTx, targetMissionSlug: mission.slug },
      }),
    });
    const resWrongAction = await verifyRoutePOST(reqWrongAction, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(resWrongAction.status).toBe(400);
    const wrongActionData = await resWrongAction.json();
    expect(wrongActionData.error).toMatch(/Action mismatch|missing slug or txHash/);

    // 5. Server challenge for RECONCILE_VALIDATION_REQUEST with mismatched payload txHash -> 400
    const goodChalReq = new NextRequest('http://localhost:3000/api/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({
        action: 'RECONCILE_VALIDATION_REQUEST',
        expectedSigner: mission.ownerAddress,
        payload: {
          slug: mission.slug,
          txHash: dummyTx,
          chainId: 43113,
          targetMissionSlug: mission.slug,
        },
      }),
    });
    const goodChalRes = await challengePOST(goodChalReq);
    const goodChalData = await goodChalRes.json();
    const goodMessage = goodChalData.message || goodChalData.challenge?.message;
    const goodNonce = goodChalData.nonce || goodChalData.challenge?.nonce;
    const goodSig = await ownerAccount.signMessage({ message: goodMessage });

    const reqMismatchedTx = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      body: JSON.stringify({
        txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', // Mismatched!
        nonce: goodNonce,
        signature: goodSig,
        payload: {
          slug: mission.slug,
          txHash: dummyTx,
          chainId: 43113,
          targetMissionSlug: mission.slug,
        },
      }),
    });
    const resMismatchedTx = await verifyRoutePOST(reqMismatchedTx, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(resMismatchedTx.status).toBe(400);

    // 6. Expired challenge nonce -> 400
    await prisma.authChallenge.update({
      where: { nonce: goodNonce },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const reqExpired = new NextRequest(`http://localhost:3000/api/verify/${mission.slug}`, {
      method: 'POST',
      body: JSON.stringify({
        txHash: dummyTx,
        nonce: goodNonce,
        signature: goodSig,
        payload: {
          slug: mission.slug,
          txHash: dummyTx,
          chainId: 43113,
          targetMissionSlug: mission.slug,
        },
      }),
    });
    const resExpired = await verifyRoutePOST(reqExpired, { params: Promise.resolve({ missionId: mission.slug }) });
    expect(resExpired.status).toBe(400);
    const expiredData = await resExpired.json();
    expect(expiredData.error).toContain('expired');
  });

  // A4-29: Strict chain response verification (no success fallbacks, rejects mismatch, preserves local 100 with chain 37)
  it('M7-A4-29: Strict chain response verification: rejects malformed/errored RPC, mismatch identity/event, and keeps local 100 distinct from chain 37', async () => {
    const registry = '0x4c5ccda2a630cd1cb706799deadcc8483d06697e';
    const valAddress = '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5';
    const reqHash = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;

    // Case 1: isValidationComplete=true but getValidationStatus throws RPC error -> UNAVAILABLE, not confirmed, no fallback to 100
    const clientRpcThrows = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') throw new Error('RPC connection reset by peer');
        throw new Error(`Unexpected call: ${functionName}`);
      }),
    } as any;

    const resThrows = await verifyStrictChainResponse({
      publicClient: clientRpcThrows,
      registryAddress: registry,
      expectedValidator: valAddress,
      expectedAgentId: '294',
      expectedRequestHash: reqHash,
    });
    expect(resThrows.isConfirmed).toBe(false);
    expect(resThrows.status).toBe('UNAVAILABLE');
    expect(resThrows.chainScore).toBeUndefined();

    // Case 2: getValidationStatus returns malformed tuple -> UNAVAILABLE, not confirmed
    const clientMalformed = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') return []; // Malformed empty array
        throw new Error(`Unexpected call: ${functionName}`);
      }),
    } as any;

    const resMalformed = await verifyStrictChainResponse({
      publicClient: clientMalformed,
      registryAddress: registry,
      expectedValidator: valAddress,
      expectedAgentId: '294',
      expectedRequestHash: reqHash,
    });
    expect(resMalformed.isConfirmed).toBe(false);
    expect(resMalformed.status).toBe('UNAVAILABLE');

    // Case 3: Validator address mismatch on registry -> FAILED, not confirmed
    const clientWrongVal = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return ['0x9999999999999999999999999999999999999999', 294n, 100, '0x2222222222222222222222222222222222222222222222222222222222222222', 'verified-full', 1700000000n];
        }
        throw new Error(`Unexpected call: ${functionName}`);
      }),
    } as any;

    const resWrongVal = await verifyStrictChainResponse({
      publicClient: clientWrongVal,
      registryAddress: registry,
      expectedValidator: valAddress,
      expectedAgentId: '294',
      expectedRequestHash: reqHash,
    });
    expect(resWrongVal.isConfirmed).toBe(false);
    expect(resWrongVal.status).toBe('FAILED');
    expect(resWrongVal.error).toContain('Validator address mismatch');

    // Case 4: Agent ID mismatch on registry -> FAILED, not confirmed
    const clientWrongAgent = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [valAddress, 9999n, 100, '0x2222222222222222222222222222222222222222222222222222222222222222', 'verified-full', 1700000000n];
        }
        throw new Error(`Unexpected call: ${functionName}`);
      }),
    } as any;

    const resWrongAgent = await verifyStrictChainResponse({
      publicClient: clientWrongAgent,
      registryAddress: registry,
      expectedValidator: valAddress,
      expectedAgentId: '294',
      expectedRequestHash: reqHash,
    });
    expect(resWrongAgent.isConfirmed).toBe(false);
    expect(resWrongAgent.status).toBe('FAILED');
    expect(resWrongAgent.error).toContain('Agent ID mismatch');

    // Case 5: Valid chain response with score 37 -> isConfirmed = true, chainScore = 37
    const clientValid37 = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [valAddress, 294n, 37, '0x3737373737373737373737373737373737373737373737373737373737373737', 'verified-partial', 1700000000n];
        }
        throw new Error(`Unexpected call: ${functionName}`);
      }),
    } as any;

    const resValid37 = await verifyStrictChainResponse({
      publicClient: clientValid37,
      registryAddress: registry,
      expectedValidator: valAddress,
      expectedAgentId: '294',
      expectedRequestHash: reqHash,
    });
    expect(resValid37.isConfirmed).toBe(true);
    expect(resValid37.status).toBe('RESPONSE_CONFIRMED');
    expect(resValid37.chainScore).toBe(37);
    expect(resValid37.chainTag).toBe('verified-partial');
  });

  // A4-30: Live lease fencing: worker 1 expires during scan, worker 2 claims, worker 1 cannot broadcast or update
  it('M7-A4-30: Live lease fencing: worker 1 cannot broadcast or update after lease expires and is reclaimed by worker 2', async () => {
    const { mission } = await createTestMission();
    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    // Initial job queued
    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'QUEUED',
        frozenContext: serializeWithBigInt(bundle),
      },
    });

    // Worker 1 claims with very short lease (10ms)
    const claim1 = await claimNextValidationJob('worker-1', 10);
    expect(claim1).not.toBeNull();
    const leaseToken1 = claim1.leaseToken;

    // Wait past worker 1's lease expiration
    await new Promise((r) => setTimeout(r, 30));

    // Worker 2 claims the expired job
    const claim2 = await claimNextValidationJob('worker-2', 60_000);
    expect(claim2).not.toBeNull();
    expect(claim2.missionSlug).toBe(mission.slug);
    expect(claim2.leaseToken).not.toBe(leaseToken1);

    // Worker 1 tries to renew lease -> throws renewal error
    await expect(renewJobLease(mission.slug, leaseToken1, 60_000)).rejects.toThrow(/Lease renewal error/);

    // Worker 1 tries to update job or advance state -> throws lease fencing error
    await expect(
      advanceValidationJob(mission.slug, {
        leaseToken: leaseToken1,
        workerId: 'worker-1',
      })
    ).rejects.toThrow(/Invalid or expired lease token|Lease fencing error/);

    // Verify DB still holds Worker 2's lease
    const currentJob = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(currentJob?.workerLeaseOwner).toBe('worker-2');
    expect(currentJob?.leaseToken).toBe(claim2.leaseToken);
  });

  // A4-31: Durable locally signed raw transaction, same-byte restart/rebroadcast, and single transaction identity
  it('M7-A4-31: Locally prepared and signed raw EVM transaction: hash matches keccak256(rawTx), same bytes rebroadcast on crash, single tx identity', async () => {
    const { mission } = await createTestMission();
    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    const testValidatorKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
    const testValidatorAccount = privateKeyToAccount(testValidatorKey);
    const expectedResponseHash = '0x2222222222222222222222222222222222222222222222222222222222222222' as const;

    const frozenCtx = buildFrozenValidationContext({
      bundle,
      ownerAddress: mission.ownerAddress,
      validatorAddress: testValidatorAccount.address,
    });
    frozenCtx.evidence = {
      evaluatedAt: new Date().toISOString(),
      responseJsonString: '{}',
      responseHash: expectedResponseHash,
      score: 100,
      tag: 'verified-full',
      checks: {},
      details: {},
    };

    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'RESPONSE_PENDING',
        score: 100,
        tag: 'verified-full',
        frozenContext: serializeWithBigInt(frozenCtx),
      },
    });

    const receivedRawTxs: `0x${string}`[] = [];
    let receiptMined = false;

    const mockPublic = {
      getChainId: vi.fn().mockResolvedValue(43113),
      getTransactionCount: vi.fn().mockResolvedValue(0n),
      estimateGas: vi.fn().mockResolvedValue(300000n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({
        maxFeePerGas: 30000000000n,
        maxPriorityFeePerGas: 1500000000n,
      }),
      sendRawTransaction: vi.fn().mockImplementation(async ({ serializedTransaction }) => {
        receivedRawTxs.push(serializedTransaction);
        return keccak256(serializedTransaction);
      }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return receiptMined;
        if (functionName === 'getValidationStatus') {
          return [
            testValidatorAccount.address,
            294n,
            100,
            expectedResponseHash,
            'verified-full',
            1700000000n,
          ];
        }
        throw new Error(`Unexpected call: ${functionName}`);
      }),
      getTransactionReceipt: vi.fn().mockImplementation(async () => {
        if (!receiptMined) return null; // Still in mempool
        const validationResponseEventAbi = parseAbiItem(
          'event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, bytes32 responseHash, string tag)'
        );
        const topics = encodeEventTopics({
          abi: [validationResponseEventAbi],
          eventName: 'ValidationResponse',
          args: {
            validatorAddress: testValidatorAccount.address,
            agentId: 294n,
            requestHash,
          },
        });
        const data = encodeAbiParameters(
          [{ type: 'uint8' }, { type: 'bytes32' }, { type: 'string' }],
          [100, expectedResponseHash, 'verified-full']
        );
        return {
          status: 'success',
          logs: [
            {
              address: DEFAULT_VALIDATION_REGISTRY,
              topics,
              data,
            },
          ],
        };
      }),
    } as any;

    // Run 1: Signs raw transaction locally, persists raw bytes and real hash in DB BEFORE sending
    const run1 = await advanceValidationJob(mission.slug, {
      publicClient: mockPublic,
      validatorPrivateKey: testValidatorKey,
    });
    expect(run1.status).toBe('RESPONSE_PENDING');
    expect(receivedRawTxs.length).toBe(1);

    // Verify raw transaction was decoded and is a valid EVM transaction
    const decodedRaw = parseTransaction(receivedRawTxs[0]);
    expect(decodedRaw.to?.toLowerCase()).toBe(DEFAULT_VALIDATION_REGISTRY.toLowerCase());
    expect(decodedRaw.chainId).toBe(43113);
    expect(decodedRaw.nonce).toBe(0);

    // Verify computed hash equals persisted hash
    const computedRealHash = keccak256(receivedRawTxs[0]);
    expect(run1.responseTxHash).toBe(computedRealHash);

    const jobAfterSend = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    expect(jobAfterSend?.responseTxHash).toBe(computedRealHash);

    // Inspect persisted frozen context: has rawTransaction and real hash
    const parsedContext = JSON.parse(jobAfterSend!.frozenContext!);
    expect(parsedContext.preparedResponse.rawTransaction).toBe(receivedRawTxs[0]);
    expect(parsedContext.preparedResponse.txHash).toBe(computedRealHash);

    // Crash simulation 1: Crash just after node accepted before DB post-send update
    // Worker restarts: Run 2 executed with the same job
    // Receipt mines in between
    receiptMined = true;
    const run2 = await advanceValidationJob(mission.slug, {
      publicClient: mockPublic,
      validatorPrivateKey: testValidatorKey,
    });

    expect(run2.status).toBe('RESPONSE_CONFIRMED');
    expect(run2.responseTxHash).toBe(computedRealHash);

    // Crash simulation 2: Crash just before first send (prepared response saved, but network dropped)
    // Create new mission where sendRawTransaction fails on first attempt
    const { mission: missionB } = await createTestMission();
    const bundleB = await buildMissionValidationBundle(missionB.slug);
    const requestHashB = computeValidationRequestHash(bundleB);
    const frozenCtxB = buildFrozenValidationContext({
      bundle: bundleB,
      ownerAddress: missionB.ownerAddress,
      validatorAddress: testValidatorAccount.address,
    });
    frozenCtxB.evidence = {
      evaluatedAt: new Date().toISOString(),
      responseJsonString: '{}',
      responseHash: expectedResponseHash,
      score: 100,
      tag: 'verified-full',
      checks: {},
      details: {},
    };
    await prisma.validationJob.create({
      data: {
        missionSlug: missionB.slug,
        missionId: missionB.missionId,
        requestHash: requestHashB,
        status: 'RESPONSE_PENDING',
        score: 100,
        tag: 'verified-full',
        frozenContext: serializeWithBigInt(frozenCtxB),
      },
    });

    const rawTxsB: `0x${string}`[] = [];
    let receiptMinedB = false;
    let shouldFailSendFirstTime = true;
    const mockPublicB = {
      ...mockPublic,
      sendRawTransaction: vi.fn().mockImplementation(async ({ serializedTransaction }) => {
        rawTxsB.push(serializedTransaction);
        if (shouldFailSendFirstTime) {
          shouldFailSendFirstTime = false;
          throw new Error('Network crash immediately during sendRawTransaction');
        }
        return keccak256(serializedTransaction);
      }),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return receiptMinedB;
        if (functionName === 'getValidationStatus') {
          return [
            testValidatorAccount.address,
            294n,
            100,
            expectedResponseHash,
            'verified-full',
            1700000000n,
          ];
        }
        throw new Error(`Unexpected call: ${functionName}`);
      }),
    };

    // Attempt 1: Prepares raw tx, persists in DB, throws during send
    await advanceValidationJob(missionB.slug, {
      publicClient: mockPublicB as any,
      validatorPrivateKey: testValidatorKey,
    });

    // Check DB has the prepared response even after network crash
    const jobB = await prisma.validationJob.findUnique({ where: { missionSlug: missionB.slug } });
    expect(jobB?.responseTxHash).toBeDefined();
    const parsedCtxB = JSON.parse(jobB!.frozenContext!);
    expect(parsedCtxB.preparedResponse.rawTransaction).toBe(rawTxsB[0]);

    // Attempt 2: Restart after crash while unmined rebroadcasts the EXACT SAME raw bytes!
    receiptMinedB = false;
    const runB2 = await advanceValidationJob(missionB.slug, {
      publicClient: mockPublicB as any,
      validatorPrivateKey: testValidatorKey,
    });
    expect(runB2.status).toBe('RESPONSE_PENDING');
    expect(rawTxsB.length).toBe(2);
    expect(rawTxsB[1]).toBe(rawTxsB[0]); // EXACT same bytes string!

    // Attempt 3: Once mined, completes confirmation with identical transaction hash
    receiptMinedB = true;
    const runB3 = await advanceValidationJob(missionB.slug, {
      publicClient: mockPublicB as any,
      validatorPrivateKey: testValidatorKey,
    });
    expect(runB3.status).toBe('RESPONSE_CONFIRMED');
    expect(runB3.responseTxHash).toBe(keccak256(rawTxsB[0])); // EXACT same hash!
  });

  // A4-33: Strict chain response verification: tuple validation, event matching, and honest external-response distinction
  it('M7-A4-33: Strict chain response verification: rejects malformed tuple hashes, absent event emitter, different event hash/tag, and distinguishes external response', async () => {
    const registry = DEFAULT_VALIDATION_REGISTRY;
    const validator = '0x83F5E5F17eE8D7BeC1968f100A11824E9c3713B5';
    const agentId = '294';
    const requestHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const expectedResponseHash = '0x2222222222222222222222222222222222222222222222222222222222222222';

    // Case 1: Malformed tuple responseHash (e.g. '0x0')
    const clientMalformedHash = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [validator, 294n, 100, '0x0', 'verified-full', 1700000000n];
        }
      }),
    } as any;
    const res1 = await verifyStrictChainResponse({
      publicClient: clientMalformedHash,
      registryAddress: registry,
      expectedValidator: validator,
      expectedAgentId: agentId,
      expectedRequestHash: requestHash,
      expectedChainId: 43113,
      expectedResponseHash,
    });
    expect(res1.isConfirmed).toBe(false);
    expect(res1.status).toBe('UNAVAILABLE');
    expect(res1.error).toContain('Missing or malformed bytes32 responseHash');

    // Case 2: Zero hash bytes32 in tuple
    const clientZeroHash = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [validator, 294n, 100, '0x0000000000000000000000000000000000000000000000000000000000000000', 'verified-full', 1700000000n];
        }
      }),
    } as any;
    const res2 = await verifyStrictChainResponse({
      publicClient: clientZeroHash,
      registryAddress: registry,
      expectedValidator: validator,
      expectedAgentId: agentId,
      expectedRequestHash: requestHash,
      expectedChainId: 43113,
      expectedResponseHash,
    });
    expect(res2.isConfirmed).toBe(false);
    expect(res2.status).toBe('UNAVAILABLE');

    // Case 3: Absent / wrong event emitter (log.address != registryAddress)
    const clientWrongEmitter = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [validator, 294n, 100, expectedResponseHash, 'verified-full', 1700000000n];
        }
      }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        logs: [
          {
            address: '0x9999999999999999999999999999999999999999', // Wrong emitter!
            topics: encodeEventTopics({
              abi: [parseAbiItem('event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, bytes32 responseHash, string tag)')],
              eventName: 'ValidationResponse',
              args: { validatorAddress: validator, agentId: 294n, requestHash },
            }),
            data: encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }, { type: 'string' }], [100, expectedResponseHash, 'verified-full']),
          },
        ],
      }),
    } as any;
    const res3 = await verifyStrictChainResponse({
      publicClient: clientWrongEmitter,
      registryAddress: registry,
      expectedValidator: validator,
      expectedAgentId: agentId,
      expectedRequestHash: requestHash,
      expectedChainId: 43113,
      expectedResponseHash,
      responseTxHash: '0xaaaa000000000000000000000000000000000000000000000000000000000001',
    });
    expect(res3.isConfirmed).toBe(false);
    expect(res3.status).toBe('FAILED');
    expect(res3.error).toContain('Matching ValidationResponse event with exact registry emitter');

    // Case 4: Different event responseHash from tuple / expected
    const clientDifferentEventHash = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [validator, 294n, 100, expectedResponseHash, 'verified-full', 1700000000n];
        }
      }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        logs: [
          {
            address: registry,
            topics: encodeEventTopics({
              abi: [parseAbiItem('event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, bytes32 responseHash, string tag)')],
              eventName: 'ValidationResponse',
              args: { validatorAddress: validator, agentId: 294n, requestHash },
            }),
            data: encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes32' }, { type: 'string' }], [100, '0x9999999999999999999999999999999999999999999999999999999999999999', 'verified-full']),
          },
        ],
      }),
    } as any;
    const res4 = await verifyStrictChainResponse({
      publicClient: clientDifferentEventHash,
      registryAddress: registry,
      expectedValidator: validator,
      expectedAgentId: agentId,
      expectedRequestHash: requestHash,
      expectedChainId: 43113,
      expectedResponseHash,
      responseTxHash: '0xaaaa000000000000000000000000000000000000000000000000000000000001',
    });
    expect(res4.isConfirmed).toBe(false);
    expect(res4.status).toBe('FAILED');

    // Case 5: Honest external-response distinction (same validator & request, but different on-chain responseHash)
    const clientExternalDiffHash = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'isValidationComplete') return true;
        if (functionName === 'getValidationStatus') {
          return [validator, 294n, 85, '0x8888888888888888888888888888888888888888888888888888888888888888', 'partial-check', 1700000000n];
        }
      }),
    } as any;
    const res5 = await verifyStrictChainResponse({
      publicClient: clientExternalDiffHash,
      registryAddress: registry,
      expectedValidator: validator,
      expectedAgentId: agentId,
      expectedRequestHash: requestHash,
      expectedChainId: 43113,
      expectedResponseHash, // '0x2222...' differs from '0x8888...'
    });
    expect(res5.isConfirmed).toBe(false);
    expect(res5.isExternalResponse).toBe(true);
    expect(res5.chainScore).toBe(85);
    expect(res5.responseHash).toBe('0x8888888888888888888888888888888888888888888888888888888888888888');
    expect(res5.status).toBe('UNAVAILABLE');

    // Case 6: Status read RPC failure fails closed and returns UNAVAILABLE
    const clientRpcFail = {
      getChainId: vi.fn().mockResolvedValue(43113),
      readContract: vi.fn().mockRejectedValue(new Error('Connection timeout to Avalanche Fuji RPC')),
    } as any;
    const res6 = await verifyStrictChainResponse({
      publicClient: clientRpcFail,
      registryAddress: registry,
      expectedValidator: validator,
      expectedAgentId: agentId,
      expectedRequestHash: requestHash,
      expectedChainId: 43113,
      expectedResponseHash,
    });
    expect(res6.isConfirmed).toBe(false);
    expect(res6.status).toBe('UNAVAILABLE');
    expect(res6.error).toContain('RPC error');
  });

  // A4-32: Truly frozen evidence & identities
  it('M7-A4-32: Truly frozen evidence & identities: rejects mutated identities with STALE_CONTEXT and reuses frozen evidence hash without re-scan', async () => {
    const { mission } = await createTestMission();
    const bundle = await buildMissionValidationBundle(mission.slug);
    const requestHash = computeValidationRequestHash(bundle);

    const context = buildFrozenValidationContext({
      bundle,
      ownerAddress: mission.ownerAddress,
    });

    await prisma.validationJob.create({
      data: {
        missionSlug: mission.slug,
        missionId: mission.missionId,
        requestHash,
        status: 'QUEUED',
        frozenContext: serializeWithBigInt(context),
      },
    });

    let scanCount = 0;
    const mockClient = createMockPublicClient(bundle);
    const origReadContract = mockClient.readContract;
    mockClient.readContract = vi.fn().mockImplementation(async (params) => {
      if (params.functionName === 'missions') {
        scanCount++;
      }
      return origReadContract(params);
    });

    // Run 1: Initial evaluation
    const res1 = await advanceValidationJob(mission.slug, {
      publicClient: mockClient,
      skipOnChainBroadcast: true,
    });
    expect(res1.status).toBe('LOCAL_EVALUATED');
    const firstScore = res1.validationResult.score;
    const jobAfter1 = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    const ctxAfter1 = JSON.parse(jobAfter1?.frozenContext || '{}');
    const firstResponseHash = ctxAfter1.evidence?.responseHash;
    const firstEvaluatedAt = ctxAfter1.evidence?.evaluatedAt;
    expect(firstResponseHash).toBeDefined();
    expect(firstEvaluatedAt).toBeDefined();

    // Run 2 with test client provided: MUST NOT re-scan because evidence is frozen!
    const res2 = await advanceValidationJob(mission.slug, {
      publicClient: mockClient,
      skipOnChainBroadcast: true,
    });
    const jobAfter2 = await prisma.validationJob.findUnique({ where: { missionSlug: mission.slug } });
    const ctxAfter2 = JSON.parse(jobAfter2?.frozenContext || '{}');
    expect(ctxAfter2.evidence?.responseHash).toBe(firstResponseHash);
    expect(ctxAfter2.evidence?.evaluatedAt).toBe(firstEvaluatedAt);

    // Run 3: Mutate configured validator in frozen context -> STALE_CONTEXT
    ctxAfter2.identities.validatorAddress = '0x0000000000000000000000000000000000000bad';
    await prisma.validationJob.update({
      where: { missionSlug: mission.slug },
      data: { frozenContext: serializeWithBigInt(ctxAfter2), status: 'QUEUED' },
    });

    const res3 = await advanceValidationJob(mission.slug, {
      publicClient: mockClient,
      skipOnChainBroadcast: true,
    });
    expect(res3.status).toBe('STALE_CONTEXT');
    expect(res3.failureReason).toContain('STALE_CONTEXT: configured identities');
  });
});
