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
          to: '0x1111111111111111111111111111111111111111',
          amount: 200000n,
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
      getBlockNumber: vi.fn().mockResolvedValue(60700000n),
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
            to: '0x9999999999999999999999999999999999999999',
            amount: 100000n,
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
            to: '0x1111111111111111111111111111111111111111',
            amount: 200000n, // Spent: 0.2 USDC
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
});
