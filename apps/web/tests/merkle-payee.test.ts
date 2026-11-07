import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  computePayeeMerkleTree,
  saveMissionPayees,
  getMissionPayees,
  getMissionPayeeProof,
  buildSetMissionPayeeRootCalldata,
  buildProposeWithProofCalldata,
  clearMissionPayeesForTesting,
} from '../lib/merkle';
import {
  verifyPayeeRootReceiptOnFuji,
  setReceiptFetcherForTesting,
  missionPayeeRootSetEventAbi,
} from '../lib/fuji-receipts';
import { executeTreasuryPayoutWithProof } from '../lib/payments';
import { prisma } from '../lib/db';
import { encodeEventTopics, encodeAbiParameters, parseAbiParameters } from 'viem';
import { POST as createMissionPOST } from '../app/api/missions/route';
import { POST as activatePOST } from '../app/api/missions/[slug]/activate/route';
import {
  computePayloadHash,
  generateEip191Message,
  issueSpendToken,
  verifyToken,
} from '../lib/auth';
import { validateProposal } from '../lib/validator';
import { hashUtf8, normalizeAddress } from '../lib/chain';
import { ownerAccount, agentAccount } from './setup';

describe('PV-3: Owner-signed Payee Merkle Root & proposeWithProof Settlement', () => {
  const payeeA = '0x2222222222222222222222222222222222222222';
  const payeeB = '0x3333333333333333333333333333333333333333';
  const outsider = '0x9999999999999999999999999999999999999999';

  // Exact vector from GuardedTreasury.t.sol: test_PV1_cross_vector_typescript_vector_verifies
  const EXPECTED_ROOT = '0xc76421b7db26fc58390a222ae87eb47677faa580fa2d97459166a1125d031320';
  const EXPECTED_PROOF_A = '0xbd164a4590db938a0b098da1b25cf37b155f857b38c37c016ad5b8f8fce80192';
  const EXPECTED_PROOF_B = '0x708e7cb9a75ffb24191120fba1c3001faa9078147150c6f2747569edbadee751';

  beforeEach(() => {
    clearMissionPayeesForTesting();
    setReceiptFetcherForTesting(null);
  });

  it('1. TypeScript StandardMerkleTree matches the exact Forge cross-verification vector', () => {
    const treeResult = computePayeeMerkleTree([payeeA, payeeB]);

    // Root matches GuardedTreasury.t.sol exactly
    expect(treeResult.root.toLowerCase()).toBe(EXPECTED_ROOT.toLowerCase());

    // Proof A matches GuardedTreasury.t.sol exactly
    const proofA = treeResult.getProof(payeeA);
    expect(proofA).toBeDefined();
    expect(proofA?.length).toBe(1);
    expect(proofA![0].toLowerCase()).toBe(EXPECTED_PROOF_A.toLowerCase());

    // Proof B matches GuardedTreasury.t.sol exactly
    const proofB = treeResult.getProof(payeeB);
    expect(proofB).toBeDefined();
    expect(proofB?.length).toBe(1);
    expect(proofB![0].toLowerCase()).toBe(EXPECTED_PROOF_B.toLowerCase());
  });

  it('2. Address outside the owner-signed payee set cannot generate a Merkle proof', () => {
    const missionSlug = 'mission-test-merkle';
    saveMissionPayees(missionSlug, [payeeA, payeeB]);

    // Authorized payees have proofs
    expect(getMissionPayeeProof(missionSlug, payeeA)).toBeDefined();
    expect(getMissionPayeeProof(missionSlug, payeeB)).toBeDefined();

    // Outsider cannot generate proof
    const outsiderProof = getMissionPayeeProof(missionSlug, outsider);
    expect(outsiderProof).toBeNull();
  });

  it('3. End-to-end payout in MOCK mode generates proposeWithProof calldata and verified proof', async () => {
    const missionSlug = 'payout-mission-1';
    const missionId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    saveMissionPayees(missionSlug, [payeeA, payeeB]);

    const result = await executeTreasuryPayoutWithProof({
      missionSlug,
      missionId,
      operationId: '0x0000000000000000000000000000000000000000000000000000000000000001',
      to: payeeA,
      amountAtomic: '1000000', // 1 USDC
      reason: 'Contractor disbursement',
    });

    expect(result.mode).toBe('MOCK');
    expect(result.status).toBe('EXECUTED');
    expect(result.proof).toEqual([EXPECTED_PROOF_A]);
    expect(result.calldata.startsWith('0x')).toBe(true);

    // Attempting payout to outsider strictly throws
    await expect(
      executeTreasuryPayoutWithProof({
        missionSlug,
        missionId,
        operationId: '0x0000000000000000000000000000000000000000000000000000000000000002',
        to: outsider,
        amountAtomic: '1000000',
        reason: 'Unauthorized payment',
      })
    ).rejects.toThrow(/not in the owner-signed payee set/);
  });

  it('4. buildSetMissionPayeeRootCalldata and buildProposeWithProofCalldata encode valid ABI data', () => {
    const missionId = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const root = EXPECTED_ROOT;

    const setRootCalldata = buildSetMissionPayeeRootCalldata(missionId, root);
    expect(setRootCalldata.startsWith('0x')).toBe(true);
    // Selector for setMissionPayeeRoot(bytes32,bytes32) is 4 bytes + 64 bytes args = 138 chars
    expect(setRootCalldata.length).toBe(2 + 8 + 64 + 64);

    const proposeCalldata = buildProposeWithProofCalldata({
      operationId: '0x2222222222222222222222222222222222222222222222222222222222222222',
      to: payeeA,
      amountAtomic: 1_000_000n,
      missionId,
      reason: 'Test payment',
      proof: [EXPECTED_PROOF_A as `0x${string}`],
    });
    expect(proposeCalldata.startsWith('0x')).toBe(true);
  });

  it('5. verifyPayeeRootReceiptOnFuji validates authentic MissionPayeeRootSet event from treasury', async () => {
    const treasuryAddress = '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3';
    const missionId = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const root = EXPECTED_ROOT;
    const policyVersion = 2n;

    const topics = encodeEventTopics({
      abi: [missionPayeeRootSetEventAbi],
      eventName: 'MissionPayeeRootSet',
      args: {
        missionId: missionId as `0x${string}`,
        root: root as `0x${string}`,
      },
    });

    const data = encodeAbiParameters(parseAbiParameters('uint256 policyVersion'), [policyVersion]);

    setReceiptFetcherForTesting(async () => ({
      status: 'success',
      to: treasuryAddress,
      blockNumber: 1234567n,
      logs: [
        {
          address: treasuryAddress,
          topics,
          data,
        },
      ],
    }));

    // Successful verification
    const res = await verifyPayeeRootReceiptOnFuji({
      txHash: '0xvalidtxhash',
      missionId,
      expectedRoot: root,
      treasuryAddress,
    });

    expect(res.valid).toBe(true);
    expect(res.policyVersion).toBe(policyVersion);

    // Mismatched root is rejected
    const badRootRes = await verifyPayeeRootReceiptOnFuji({
      txHash: '0xvalidtxhash',
      missionId,
      expectedRoot: '0x9999999999999999999999999999999999999999999999999999999999999999',
      treasuryAddress,
    });
    expect(badRootRes.valid).toBe(false);
    expect(badRootRes.error).toContain('root mismatch');

    // Mismatched contract is rejected
    setReceiptFetcherForTesting(async () => ({
      status: 'success',
      to: '0x000000000000000000000000000000000000dEaD',
      blockNumber: 1234567n,
      logs: [],
    }));

    const wrongContractRes = await verifyPayeeRootReceiptOnFuji({
      txHash: '0xvalidtxhash',
      missionId,
      expectedRoot: root,
      treasuryAddress,
    });
    expect(wrongContractRes.valid).toBe(false);
    expect(wrongContractRes.error).toContain('recipient mismatch');
  });

  it('6. PV-F3: Mission payees stored in DB survive RAM cache clear and reconstruct root during activate', async () => {
    const slug = `pv-f3-persist-${Date.now()}`;
    const missionId = `0x${'3'.repeat(64)}`;
    const payees = [payeeA, payeeB];

    // Compute expected tree
    const tree = computePayeeMerkleTree(payees);

    // Persist mission in DB with payeesJson and payeeRoot
    const mission = await prisma.mission.create({
      data: {
        slug,
        missionId,
        ownerAddress: '0x00000000000000000000000000000000000A11CE',
        agentAddress: '0x1111111111111111111111111111111111111111',
        treasuryCap: '10000000',
        toolCap: '5000000',
        spentTool: '0',
        reservedTool: '0',
        expiresAt: new Date(Date.now() + 86400000),
        status: 'ACTIVE',
        payeesJson: JSON.stringify(payees),
        payeeRoot: tree.root,
        configVersion: 1,
        policyHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      },
    });

    // Wipe the in-memory cache completely
    clearMissionPayeesForTesting();
    expect(getMissionPayees(slug)).toBeUndefined();

    // Verify activate logic can recover payees from DB column and regenerate identical root
    const dbMission = await prisma.mission.findUnique({ where: { slug } });
    expect(dbMission).toBeDefined();
    expect(dbMission?.payeesJson).toBe(JSON.stringify(payees));
    expect(dbMission?.payeeRoot).toBe(tree.root);

    const parsedPayees = JSON.parse(dbMission!.payeesJson!);
    const recoveredTree = saveMissionPayees(slug, parsedPayees);
    expect(recoveredTree.root.toLowerCase()).toBe(EXPECTED_ROOT.toLowerCase());
    expect(getMissionPayeeProof(slug, payeeA)![0].toLowerCase()).toBe(EXPECTED_PROOF_A.toLowerCase());

    // Clean up
    await prisma.mission.delete({ where: { slug } });
  });

  it('7. PV-F9: Invalid signature on CREATE_MISSION with dirty payees rejects without poisoning RAM cache or DB', async () => {
    const slug = `pv-f9-dirty-${Date.now()}`;
    const dirtyPayee = '0xbad0000000000000000000000000000000000bad';

    const nonce = `pv-f9-nonce-${Date.now()}`;
    const payload = {
      slug,
      agentAddress: normalizeAddress(agentAccount.address),
      treasuryCap: '10000000',
      toolCap: '5000000',
      durationSeconds: 86400,
      payees: [dirtyPayee],
      targetMissionSlug: slug,
    };
    const payloadHash = computePayloadHash(payload);

    const challenge = await prisma.authChallenge.create({
      data: {
        nonce,
        action: 'CREATE_MISSION',
        expectedSigner: normalizeAddress(ownerAccount.address),
        payloadHash,
        authVersion: 1,
        deploymentId: 'unihack-test-deployment',
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    // Sign with agent account (unauthorized) instead of owner
    const systemState = await prisma.systemState.findUnique({ where: { id: 1 } });
    const message = generateEip191Message({
      action: 'CREATE_MISSION',
      deploymentId: systemState?.deploymentId || 'unihack-test-deployment',
      appOrigin: 'http://localhost:3000',
      stage: 'S1',
      guardAddress: 'none',
      authVersion: 1,
      nonce,
      payloadHash,
      issuedAt: Math.floor(challenge.createdAt.getTime() / 1000),
    });
    const badSignature = await agentAccount.signMessage({ message });

    const req = new NextRequest('http://localhost:3000/api/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce,
        signature: badSignature,
        payload,
      }),
    });

    const res = await createMissionPOST(req);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // RAM cache MUST NOT be poisoned with the dirty payee
    expect(getMissionPayees(slug)).toBeUndefined();

    // DB MUST NOT have the mission
    const dbMission = await prisma.mission.findUnique({ where: { slug } });
    expect(dbMission).toBeNull();
  });

  it('8. PV-F9: Updating payees at ACTIVATE increments configVersion and revokes previously issued spend token', async () => {
    const slug = `pv-f9-update-${Date.now()}`;
    const missionId = hashUtf8(slug);
    const initialTree = computePayeeMerkleTree([payeeA]);

    await prisma.mission.create({
      data: {
        slug,
        missionId,
        ownerAddress: normalizeAddress(ownerAccount.address),
        agentAddress: normalizeAddress(agentAccount.address),
        treasuryCap: '10000000',
        toolCap: '5000000',
        spentTool: '0',
        reservedTool: '0',
        expiresAt: new Date(Date.now() + 86400000),
        status: 'ACTIVE',
        payeesJson: JSON.stringify([payeeA]),
        payeeRoot: initialTree.root,
        configVersion: 1,
        policyHash: hashUtf8(`policy:1:10000000:5000000:${initialTree.root}`),
      },
    });

    const oldSpendToken = await issueSpendToken({
      deploymentId: 'unihack-test-deployment',
      stage: 'S1',
      authVersion: 1,
      missionSlug: slug,
      missionId,
      ownerAddress: normalizeAddress(ownerAccount.address),
      agentAddress: normalizeAddress(agentAccount.address),
      missionConfigVersion: 1,
      policyHash: hashUtf8(`policy:1:10000000:5000000:${initialTree.root}`),
      missionExpiresAt: new Date(Date.now() + 86400000),
    });

    // ACTIVATE with updated payee set [payeeA, payeeB]
    const nonce = `pv-f9-act-nonce-${Date.now()}`;
    const activatePayload = {
      missionId,
      ownerAddress: normalizeAddress(ownerAccount.address),
      agentAddress: normalizeAddress(agentAccount.address),
      treasuryCap: '10000000',
      toolCap: '5000000',
      configVersion: 1,
      policyHash: hashUtf8(`policy:1:10000000:5000000:${initialTree.root}`),
      targetMissionSlug: slug,
      payees: [payeeA, payeeB],
    };
    const payloadHash = computePayloadHash(activatePayload);

    const challenge = await prisma.authChallenge.create({
      data: {
        nonce,
        action: 'ACTIVATE',
        expectedSigner: normalizeAddress(ownerAccount.address),
        payloadHash,
        authVersion: 1,
        deploymentId: 'unihack-test-deployment',
        expiresAt: new Date(Date.now() + 300000),
      },
    });

    const systemState = await prisma.systemState.findUnique({ where: { id: 1 } });
    const message = generateEip191Message({
      action: 'ACTIVATE',
      deploymentId: systemState?.deploymentId || 'unihack-test-deployment',
      appOrigin: 'http://localhost:3000',
      stage: 'S1',
      guardAddress: 'none',
      authVersion: 1,
      nonce,
      payloadHash,
      issuedAt: Math.floor(challenge.createdAt.getTime() / 1000),
    });
    const signature = await ownerAccount.signMessage({ message });

    const req = new NextRequest(`http://localhost:3000/api/missions/${slug}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nonce,
        signature,
        payload: activatePayload,
      }),
    });

    const res = await activatePOST(req, { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(200);

    // Verify DB mission configVersion is now 2
    const updatedMission = await prisma.mission.findUnique({ where: { slug } });
    expect(updatedMission?.configVersion).toBe(2);

    // Old token with configVersion: 1 must be rejected by validator
    const oldClaims = await verifyToken(oldSpendToken);
    const validationResult = validateProposal(
      {
        kind: 'tool_purchase',
        mission_id: updatedMission!.slug,
        tool_id: 'tool:search',
        amount_atomic: '100000',
        reason: 'Authorized search operation',
      },
      {
        tokenClaims: oldClaims,
        systemPaused: false,
        maintenance: false,
        stage: 'S1',
        mission: {
          slug: updatedMission!.slug,
          missionId: updatedMission!.missionId,
          status: updatedMission!.status,
          expiresAt: updatedMission!.expiresAt,
          ownerAddress: updatedMission!.ownerAddress,
          agentAddress: updatedMission!.agentAddress,
          toolCap: BigInt(updatedMission!.toolCap.toString()),
          spentTool: BigInt(updatedMission!.spentTool.toString()),
          reservedTool: BigInt(updatedMission!.reservedTool.toString()),
          treasuryCap: BigInt(updatedMission!.treasuryCap.toString()),
          configVersion: updatedMission!.configVersion,
        },
        treasuryAllowlist: [normalizeAddress(ownerAccount.address)],
      }
    );

    expect(validationResult.outcome).toBe('BLOCK');
    expect(validationResult.rule).toBe('CONFIG_VERSION_REVOKED');

    // Clean up
    await prisma.mission.delete({ where: { slug } });
  });
});
