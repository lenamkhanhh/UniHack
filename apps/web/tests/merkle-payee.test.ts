import { describe, it, expect, beforeEach } from 'vitest';
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
import { encodeEventTopics, encodeAbiParameters, parseAbiParameters } from 'viem';

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
});
