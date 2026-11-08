import { describe, it, expect, vi } from 'vitest';
import {
  computeValidationRequestHash,
  validateBundleOnChain,
  ValidationBundle,
} from '../lib/validation-bundle';
import { computePayeeMerkleTree } from '../lib/merkle';

describe('ERC-8004 Validation Bundle Specification', () => {
  const FIXED_TEST_VECTOR: ValidationBundle = {
    version: 'MissionPay-validation-v1',
    missionId: '0x0000000000000000000000000000000000000000000000000000000000000001',
    payeeRoot: '0x0000000000000000000000000000000000000000000000000000000000000002',
    auditHead: '0x0000000000000000000000000000000000000000000000000000000000000003',
    anchorTxHash: '0x0000000000000000000000000000000000000000000000000000000000000004',
    chainId: 43113,
    treasury: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
    payees: ['0x1111111111111111111111111111111111111111'],
  };

  it('matches exact cast keccak reference vector independently verified', () => {
    // cast keccak $(cast abi-encode "test(string,bytes32,bytes32,bytes32,bytes32,uint256,address)" ...)
    const hash = computeValidationRequestHash(FIXED_TEST_VECTOR);
    expect(hash).toBe('0x75077576a2e0a6c057a6e770b009b1a2ef92fea9de342a830f440da18a33406d');
  });

  const validPayees = ['0x1111111111111111111111111111111111111111'];
  const tree = computePayeeMerkleTree(validPayees);

  const baseBundle: ValidationBundle = {
    version: 'MissionPay-validation-v1',
    missionId: '0xeb8f4a47323136c557439a5f0f90b73222f28b8725c0e4e480256621c10682f4',
    payeeRoot: tree.root,
    auditHead: '0x7d46d87541ed812ada52afe7f1d3144d6a2b90b359a66162e54c8e41d675be2f',
    anchorTxHash: '0x43bd21b81248a9f1a4dc2ff037a3df8119ae098690cd4e353bdbb4ce6ceb0547',
    chainId: 43113,
    treasury: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
    payees: validPayees,
  };

  function createMockPublicClient(overrides: {
    onChainHead?: `0x${string}`;
    onChainRoot?: `0x${string}`;
    cap?: bigint;
    logs?: any[];
  } = {}) {
    const onChainHead = overrides.onChainHead ?? baseBundle.auditHead;
    const onChainRoot = overrides.onChainRoot ?? baseBundle.payeeRoot;
    const cap = overrides.cap ?? 2000000n;
    const logs = overrides.logs ?? [
      {
        args: {
          id: 1n,
          to: '0x1111111111111111111111111111111111111111',
          amount: 200000n,
          missionId: baseBundle.missionId,
        },
      },
    ];

    return {
      readContract: vi.fn().mockImplementation(async ({ functionName }) => {
        if (functionName === 'anchoredMissionProofs') return onChainHead;
        if (functionName === 'missionPayeeRoot') return onChainRoot;
        if (functionName === 'missions') {
          return [baseBundle.missionId, '0x374b8A126FDb9e5deEc8307da385076155Af3D72', cap, 1794670342n, true, false];
        }
        throw new Error(`Unexpected function call: ${functionName}`);
      }),
      getBlockNumber: vi.fn().mockResolvedValue(60685230n),
      getLogs: vi.fn().mockResolvedValue(logs),
    } as any;
  }

  it('evaluates score 100 for verified valid bundle', async () => {
    const mockClient = createMockPublicClient();
    const result = await validateBundleOnChain(mockClient, baseBundle);

    expect(result.valid).toBe(true);
    expect(result.score).toBe(100);
    expect(result.tag).toBe('verified-full');
    expect(result.checks.headMatchesOnChain).toBe(true);
    expect(result.checks.rootMatchesOnChain).toBe(true);
    expect(result.checks.payeesGenerateRoot).toBe(true);
    expect(result.checks.executedPayeesValid).toBe(true);
    expect(result.checks.totalSpendWithinCap).toBe(true);
  });

  it('rejects tampered payeeRoot with score 0 and root mismatch tag', async () => {
    const tamperedBundle: ValidationBundle = {
      ...baseBundle,
      payeeRoot: '0xbad0000000000000000000000000000000000000000000000000000000000000',
    };

    const mockClient = createMockPublicClient();
    const result = await validateBundleOnChain(mockClient, tamperedBundle);

    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.checks.rootMatchesOnChain).toBe(false);
    expect(result.details.failedChecks).toContain('ROOT_MISMATCH');
  });

  it('rejects tampered auditHead with score 0 and head mismatch tag', async () => {
    const tamperedBundle: ValidationBundle = {
      ...baseBundle,
      auditHead: '0xdeadbeef00000000000000000000000000000000000000000000000000000000',
    };

    const mockClient = createMockPublicClient();
    const result = await validateBundleOnChain(mockClient, tamperedBundle);

    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.checks.headMatchesOnChain).toBe(false);
    expect(result.details.failedChecks).toContain('HEAD_MISMATCH');
  });

  it('rejects bundle with unauthorized payee in executed logs', async () => {
    const mockClient = createMockPublicClient({
      logs: [
        {
          args: {
            id: 1n,
            to: '0x9999999999999999999999999999999999999999',
            amount: 100000n,
            missionId: baseBundle.missionId,
          },
        },
      ],
    });

    const result = await validateBundleOnChain(mockClient, baseBundle);

    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.checks.executedPayeesValid).toBe(false);
    expect(result.details.failedChecks).toContain('EXECUTED_PAYEE_UNAUTHORIZED');
  });

  it('rejects bundle when total spend exceeds mission cap', async () => {
    const mockClient = createMockPublicClient({
      cap: 100000n, // Cap: 0.1 USDC
      logs: [
        {
          args: {
            id: 1n,
            to: '0x1111111111111111111111111111111111111111',
            amount: 200000n, // Spent: 0.2 USDC
            missionId: baseBundle.missionId,
          },
        },
      ],
    });

    const result = await validateBundleOnChain(mockClient, baseBundle);

    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.checks.totalSpendWithinCap).toBe(false);
    expect(result.details.failedChecks).toContain('SPEND_EXCEEDS_CAP');
  });

  it('W2-F1: verifies real transaction 0x769484bb...6c9a fixture log produces executedCount = 1 and total = 200000', async () => {
    // Real Fuji tx 0x769484bb45b13a42917972dabb206697ec4f21acd117394017a62e0046cd6c9a (block 60689765)
    const realFujiLog = {
      address: baseBundle.treasury,
      blockNumber: 60689765n,
      transactionHash: '0x769484bb45b13a42917972dabb206697ec4f21acd117394017a62e0046cd6c9a',
      args: {
        id: 1n,
        to: '0x1111111111111111111111111111111111111111',
        amount: 200000n,
        missionId: baseBundle.missionId,
      },
    };

    const mockClient = createMockPublicClient({ logs: [realFujiLog] });
    const result = await validateBundleOnChain(mockClient, baseBundle);

    expect(result.valid).toBe(true);
    expect(result.score).toBe(100);
    expect(result.tag).toBe('verified-full');
    expect(result.details.executedCount).toBe(1);
    expect(result.details.totalExecutedAmount).toBe('200000');

    // Tampered bundle: removing 0x1111... from payees causes EXECUTED_PAYEE_UNAUTHORIZED and score 0
    const tamperedBundle: ValidationBundle = {
      ...baseBundle,
      payees: ['0x2222222222222222222222222222222222222222'],
    };
    const tamperedResult = await validateBundleOnChain(mockClient, tamperedBundle);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.score).toBe(0);
    expect(tamperedResult.checks.executedPayeesValid).toBe(false);
    expect(tamperedResult.details.failedChecks).toContain('EXECUTED_PAYEE_UNAUTHORIZED');
  });

  it('W2-F1: marks no executions found when executedCount = 0 and denies verified-full', async () => {
    const mockClient = createMockPublicClient({ logs: [] });
    const result = await validateBundleOnChain(mockClient, baseBundle);

    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
    expect(result.checks.hasExecutions).toBe(false);
    expect(result.details.executedCount).toBe(0);
    expect(result.details.failedChecks).toContain('NO_EXECUTIONS_FOUND');
    expect(result.tag).not.toBe('verified-full');
  });
});
