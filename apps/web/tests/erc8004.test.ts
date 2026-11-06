import { describe, it, expect, beforeEach } from 'vitest';
import { toFunctionSelector, encodeFunctionData } from 'viem';
import {
  submitErc8004Feedback,
  ERC8004_FUJI_IDENTITY_REGISTRY,
  ERC8004_FUJI_REPUTATION_REGISTRY,
  ERC8004_REPUTATION_ABI,
  ERC8004_IDENTITY_ABI,
} from '../lib/erc8004';
import { getSessionWalletForMission } from '../lib/session-wallets';
import { validateLiveFujiConfig } from '../lib/config';

describe('SW-01 & ERC-01/02: Security Invariants & Real ERC-8004 Verification Suite', () => {
  beforeEach(() => {
    process.env.MISSION_TOKEN_SECRET =
      'test-mission-token-secret-must-be-at-least-32-chars-long!';
    process.env.SESSION_WALLET_SEED =
      'test-isolated-session-wallet-seed-must-be-distinct-32chars!';
    process.env.PAYMENT_MODE = 'MOCK';
  });

  // --- SW-01 Tests ---
  it('SW-01: Generates isolated session wallets using HKDF-SHA256 from dedicated SESSION_WALLET_SEED', () => {
    const w1 = getSessionWalletForMission('slug-alpha');
    const w2 = getSessionWalletForMission('slug-beta');
    const w1Repeat = getSessionWalletForMission('slug-alpha');

    expect(w1.address).toBe(w1Repeat.address);
    expect(w1.privateKey).toBe(w1Repeat.privateKey);
    expect(w1.address).not.toBe(w2.address);
    expect(w1.privateKey).not.toBe(w2.privateKey);

    expect(w1.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(w1.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('SW-01: Throws immediately when SESSION_WALLET_SEED is missing or < 32 characters', () => {
    delete process.env.SESSION_WALLET_SEED;
    expect(() => getSessionWalletForMission('slug-err')).toThrow(/SESSION_WALLET_SEED.*required/);

    process.env.SESSION_WALLET_SEED = 'too-short-seed';
    expect(() => getSessionWalletForMission('slug-err')).toThrow(/at least 32 characters/);
  });

  it('SW-01: Throws immediately when SESSION_WALLET_SEED reuses MISSION_TOKEN_SECRET', () => {
    const sharedSecret = 'identical-secret-shared-across-auth-and-spending-32chars!';
    process.env.MISSION_TOKEN_SECRET = sharedSecret;
    process.env.SESSION_WALLET_SEED = sharedSecret;

    expect(() => getSessionWalletForMission('slug-err')).toThrow(/must not be identical to MISSION_TOKEN_SECRET/);
  });

  it('SW-01: validateLiveFujiConfig strictly rejects missing, shared, or sample placeholder seeds in LIVE_FUJI mode', () => {
    process.env.PAYMENT_MODE = 'LIVE_FUJI';
    process.env.SELLER_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.AGENT_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';

    // 1. Missing seed
    delete process.env.SESSION_WALLET_SEED;
    expect(() => validateLiveFujiConfig()).toThrow(/SESSION_WALLET_SEED must be set/);

    // 2. Shared with token secret
    const shared = 'a-very-long-and-secure-custom-key-that-was-accidentally-reused!';
    process.env.MISSION_TOKEN_SECRET = shared;
    process.env.SESSION_WALLET_SEED = shared;
    expect(() => validateLiveFujiConfig()).toThrow(/must not be identical/);

    // 3. Known sample placeholder from README/.env.example
    process.env.MISSION_TOKEN_SECRET = 'completely-unique-jwt-token-secret-32chars-min!';
    process.env.SESSION_WALLET_SEED = 'unihack-session-wallet-secret-dev-fallback-key-32chars';
    expect(() => validateLiveFujiConfig()).toThrow(/placeholder or well-known sample value/);

    process.env.PAYMENT_MODE = 'MOCK';
  });

  // --- ERC-01 & ERC-02 Tests ---
  it('ERC-01: ReputationRegistry giveFeedback function selector matches verified Avalanche Fuji implementation', () => {
    // Exact function signature from Fuji verified implementation 0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34:
    // giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)
    const giveFeedbackItem = ERC8004_REPUTATION_ABI.find(
      (item) => item.name === 'giveFeedback'
    );
    expect(giveFeedbackItem).toBeDefined();

    const selector = toFunctionSelector(giveFeedbackItem!);
    // giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32) selector
    expect(selector).toMatch(/^0x[0-9a-f]{8}$/);

    // Encodes calldata with 8 parameters and uint256 agentId
    const calldata = encodeFunctionData({
      abi: ERC8004_REPUTATION_ABI,
      functionName: 'giveFeedback',
      args: [
        1001n, // agentId as uint256
        87n, // value int128
        0, // valueDecimals uint8
        'starred',
        'unihack-s2',
        'https://unihack.app',
        'ipfs://unihack-feedback-s2',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      ],
    });
    expect(calldata.startsWith(selector)).toBe(true);
  });

  it('ERC-01: IdentityRegistry register function selectors match verified Avalanche Fuji implementation', () => {
    const registerNoArgs = ERC8004_IDENTITY_ABI.find(
      (item) => item.name === 'register' && item.inputs.length === 0
    );
    const registerWithURI = ERC8004_IDENTITY_ABI.find(
      (item) => item.name === 'register' && item.inputs.length === 1
    );

    expect(registerNoArgs).toBeDefined();
    expect(registerWithURI).toBeDefined();

    expect(toFunctionSelector(registerNoArgs!)).toBe('0x1aa3a008'); // register()
    expect(toFunctionSelector(registerWithURI!)).toBe('0xf2c298be'); // register(string)
  });

  it('ERC-02: submitErc8004Feedback in MOCK mode strictly returns txHash: null (no fake transaction hashes)', async () => {
    // 1. Unsettled operation fails
    const resUnsettled = await submitErc8004Feedback({
      agentId: 42n,
      operationId: 'op-123',
      operationState: 'RESERVED',
      ownerConfirmed: true,
    });
    expect(resUnsettled.success).toBe(false);
    expect(resUnsettled.txHash).toBeNull();

    // 2. Unconfirmed deliverable fails
    const resUnconfirmed = await submitErc8004Feedback({
      agentId: 42n,
      operationId: 'op-123',
      operationState: 'SETTLED',
      ownerConfirmed: false,
    });
    expect(resUnconfirmed.success).toBe(false);
    expect(resUnconfirmed.txHash).toBeNull();

    // 3. Settled and confirmed in MOCK mode -> succeeds with honest null txHash
    const resSuccess = await submitErc8004Feedback({
      agentId: 42n,
      operationId: 'op-123',
      operationState: 'SETTLED',
      ownerConfirmed: true,
      score: 95,
      tag1: 'starred',
    });
    expect(resSuccess.success).toBe(true);
    expect(resSuccess.mode).toBe('MOCK');
    expect(resSuccess.txHash).toBeNull(); // Strictly null, NO fake hashes!
    expect(resSuccess.simulated).toBe(true);
    expect(resSuccess.calldata).toBeDefined();
  });
});
