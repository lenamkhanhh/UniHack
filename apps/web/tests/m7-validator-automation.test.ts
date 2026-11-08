import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem';
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
  DEFAULT_VALIDATION_REGISTRY,
} from '@/lib/validator-job';
import { computeValidationRequestHash } from '@/lib/validation-bundle';
import { computePayeeMerkleTree } from '@/lib/merkle';
import { POST as closeRoutePOST } from '@/app/api/missions/[slug]/close/route';
import { POST as challengePOST } from '@/app/api/auth/challenge/route';
import { GET as verifyRouteGET } from '@/app/api/verify/[missionId]/route';
import { setAnchorFetcherForTesting } from '@/lib/config';

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
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'anchoredMissionProofs') return head;
        if (functionName === 'missionPayeeRoot') return root;
        if (functionName === 'missions') {
          return [bundle.missionId, bundle.treasury, 2000000n, 1794670342n, true, true];
        }
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
    expect(json.erc8004Validation.isComplete).toBe(true);
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

    const updatedMission = await prisma.mission.findUnique({ where: { slug: mission.slug } });
    expect(updatedMission?.status).toBe('CLOSED');
  });

  // 6. Live Anvil Fork test: Tamper detection -> Score 0 on-chain with dedicated validator key
  it.skipIf(!process.env.VALIDATOR_PRIVATE_KEY?.trim())('M7-06: Live Anvil fork: validator evaluates tampered state -> submits score 0 -> records on-chain', async () => {
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
});
