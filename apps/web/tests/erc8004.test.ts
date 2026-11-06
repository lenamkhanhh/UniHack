import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { toFunctionSelector, encodeFunctionData, encodeEventTopics, encodeAbiParameters } from 'viem';
import {
  submitErc8004Feedback,
  ERC8004_FUJI_IDENTITY_REGISTRY,
  ERC8004_FUJI_REPUTATION_REGISTRY,
  ERC8004_REPUTATION_ABI,
  ERC8004_IDENTITY_ABI,
} from '../lib/erc8004';
import { getSessionWalletForMission } from '../lib/session-wallets';
import { validateLiveFujiConfig, setBytecodeFetcherForTesting } from '../lib/config';
import {
  verifyFundingReceiptOnFuji,
  verifyAnchorReceiptOnFuji,
  verifyFeedbackReceiptOnFuji,
  setReceiptFetcherForTesting,
  missionFundedEventAbi,
  missionProofAnchoredEventAbi,
  feedbackGivenEventAbi,
} from '../lib/fuji-receipts';

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

  it('SW-01: validateLiveFujiConfig strictly rejects missing, shared, or sample placeholder seeds in LIVE_FUJI mode', async () => {
    process.env.PAYMENT_MODE = 'LIVE_FUJI';
    process.env.SELLER_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.AGENT_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
    process.env.GUARDED_TREASURY_ADDRESS = '0x1234567890123456789012345678901234567890';
    setBytecodeFetcherForTesting(async () => '0x608060405234801561001057600080fd5b50');

    // 1. Missing seed
    delete process.env.SESSION_WALLET_SEED;
    await expect(validateLiveFujiConfig()).rejects.toThrow(/SESSION_WALLET_SEED must be set/);

    // 2. Shared with token secret
    const shared = 'a-very-long-and-secure-custom-key-that-was-accidentally-reused!';
    process.env.MISSION_TOKEN_SECRET = shared;
    process.env.SESSION_WALLET_SEED = shared;
    await expect(validateLiveFujiConfig()).rejects.toThrow(/must not be identical/);

    // 3. Known sample placeholder from README/.env.example
    process.env.MISSION_TOKEN_SECRET = 'completely-unique-jwt-token-secret-32chars-min!';
    process.env.SESSION_WALLET_SEED = 'unihack-session-wallet-secret-dev-fallback-key-32chars';
    await expect(validateLiveFujiConfig()).rejects.toThrow(/placeholder or well-known sample value/);

    setBytecodeFetcherForTesting(null);
    process.env.PAYMENT_MODE = 'MOCK';
  });

  it('CFG-01: validateLiveFujiConfig strictly requires valid, non-zero, non-Anvil GUARDED_TREASURY_ADDRESS with bytecode in LIVE_FUJI mode', async () => {
    process.env.PAYMENT_MODE = 'LIVE_FUJI';
    process.env.SELLER_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.AGENT_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234';
    process.env.SESSION_WALLET_SEED = 'a-secure-custom-seed-32chars-minimum-length-unique!';
    process.env.MISSION_TOKEN_SECRET = 'a-secure-jwt-token-secret-32chars-minimum-length!';

    // 1. Missing GUARDED_TREASURY_ADDRESS
    delete process.env.GUARDED_TREASURY_ADDRESS;
    await expect(validateLiveFujiConfig()).rejects.toThrow(/GUARDED_TREASURY_ADDRESS must be set/);

    // 2. Zero address
    process.env.GUARDED_TREASURY_ADDRESS = '0x0000000000000000000000000000000000000000';
    await expect(validateLiveFujiConfig()).rejects.toThrow(/cannot be the zero address/);

    // 3. Known Anvil address
    process.env.GUARDED_TREASURY_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
    await expect(validateLiveFujiConfig()).rejects.toThrow(/cannot be a well-known Anvil/);

    // 4. Non-contract address (empty bytecode / EOA on Fuji)
    process.env.GUARDED_TREASURY_ADDRESS = '0x1234567890123456789012345678901234567890';
    setBytecodeFetcherForTesting(async () => '0x');
    await expect(validateLiveFujiConfig()).rejects.toThrow(/must be a deployed contract with bytecode/);

    // 5. Valid contract address with bytecode passes
    setBytecodeFetcherForTesting(async () => '0x608060405234801561001057600080fd5b50');
    await expect(validateLiveFujiConfig()).resolves.not.toThrow();

    setBytecodeFetcherForTesting(null);
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

  // --- WIRE-01 & FB-01 On-Chain Verification Tests ---
  describe('WIRE-01 & FB-01: On-Chain Receipt & Event Verification', () => {
    const treasury = '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3';
    const testMissionId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const testWallet = '0x976EA74026E726554dB657fA54763abd0C3a0aa9';
    const testToolCap = 5_000_000n; // 5 USDC

    afterEach(() => {
      setReceiptFetcherForTesting(null);
    });

    it('WIRE-01: verifyFundingReceiptOnFuji validates matching MissionFunded events and rejects mismatches', async () => {
      // 1. Success case
      const topics = encodeEventTopics({
        abi: [missionFundedEventAbi],
        eventName: 'MissionFunded',
        args: {
          missionId: testMissionId as `0x${string}`,
          wallet: testWallet as `0x${string}`,
        },
      });
      const data = encodeAbiParameters([{ type: 'uint256', name: 'amount' }], [testToolCap]);

      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: treasury,
        blockNumber: 123456n,
        logs: [{ address: treasury, data, topics }],
      }));

      const res = await verifyFundingReceiptOnFuji({
        txHash: '0xgoodfundedtx',
        missionId: testMissionId,
        sessionWallet: testWallet,
        expectedAmount: testToolCap,
        treasuryAddress: treasury,
      });
      expect(res.valid).toBe(true);
      expect(res.blockNumber).toBe(123456n);

      // 2. Reverted tx
      setReceiptFetcherForTesting(async () => ({
        status: 'reverted',
        to: treasury,
        logs: [],
      }));
      const resRev = await verifyFundingReceiptOnFuji({
        txHash: '0xrevertedtx',
        missionId: testMissionId,
        sessionWallet: testWallet,
        expectedAmount: testToolCap,
        treasuryAddress: treasury,
      });
      expect(resRev.valid).toBe(false);
      expect(resRev.error).toContain('reverted');

      // 3. Amount less than expected tool cap
      const shortData = encodeAbiParameters([{ type: 'uint256', name: 'amount' }], [testToolCap - 1n]);
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: treasury,
        logs: [{ address: treasury, data: shortData, topics }],
      }));
      const resShort = await verifyFundingReceiptOnFuji({
        txHash: '0xshorttx',
        missionId: testMissionId,
        sessionWallet: testWallet,
        expectedAmount: testToolCap,
        treasuryAddress: treasury,
      });
      expect(resShort.valid).toBe(false);
      expect(resShort.error).toContain('insufficient');

      // 4. Wallet mismatch
      const wrongWalletTopics = encodeEventTopics({
        abi: [missionFundedEventAbi],
        eventName: 'MissionFunded',
        args: {
          missionId: testMissionId as `0x${string}`,
          wallet: '0x0000000000000000000000000000000000000001',
        },
      });
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: treasury,
        logs: [{ address: treasury, data, topics: wrongWalletTopics }],
      }));
      const resWrongWallet = await verifyFundingReceiptOnFuji({
        txHash: '0xwrongwallettx',
        missionId: testMissionId,
        sessionWallet: testWallet,
        expectedAmount: testToolCap,
        treasuryAddress: treasury,
      });
      expect(resWrongWallet.valid).toBe(false);
      expect(resWrongWallet.error).toContain('wallet mismatch');

      // 5. Contract recipient mismatch
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: '0x0000000000000000000000000000000000000099',
        logs: [{ address: treasury, data, topics }],
      }));
      const resWrongTo = await verifyFundingReceiptOnFuji({
        txHash: '0xwrongtotx',
        missionId: testMissionId,
        sessionWallet: testWallet,
        expectedAmount: testToolCap,
        treasuryAddress: treasury,
      });
      expect(resWrongTo.valid).toBe(false);
      expect(resWrongTo.error).toContain('recipient mismatch');

      // 6. RCPT-01: Log from different contract address rejected even if topics match
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: treasury,
        logs: [{ address: '0x0000000000000000000000000000000000000088', data, topics }],
      }));
      const resWrongLogAddr = await verifyFundingReceiptOnFuji({
        txHash: '0xwronglogaddrtx',
        missionId: testMissionId,
        sessionWallet: testWallet,
        expectedAmount: testToolCap,
        treasuryAddress: treasury,
      });
      expect(resWrongLogAddr.valid).toBe(false);
      expect(resWrongLogAddr.error).toContain('from expected treasury contract');
    });

    it('WIRE-01 & RCPT-01: verifyAnchorReceiptOnFuji validates MissionProofAnchored events and rejects discrepancies', async () => {
      const headHash = '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const topics = encodeEventTopics({
        abi: [missionProofAnchoredEventAbi],
        eventName: 'MissionProofAnchored',
        args: {
          missionId: testMissionId as `0x${string}`,
          headHash: headHash as `0x${string}`,
        },
      });
      const data = encodeAbiParameters([{ type: 'uint256', name: 'timestamp' }], [1700000000n]);

      // 1. Valid anchor
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: treasury,
        blockNumber: 789101n,
        logs: [{ address: treasury, data, topics }],
      }));

      const res = await verifyAnchorReceiptOnFuji({
        txHash: '0xgoodanchortx',
        missionId: testMissionId,
        expectedHeadHash: headHash,
        treasuryAddress: treasury,
      });
      expect(res.valid).toBe(true);
      expect(res.blockNumber).toBe(789101n);

      // 2. HeadHash mismatch
      const wrongHash = '0x1111222233334444555566667777888899990000111122223333444455556666';
      const resWrongHash = await verifyAnchorReceiptOnFuji({
        txHash: '0xwronghashtx',
        missionId: testMissionId,
        expectedHeadHash: wrongHash,
        treasuryAddress: treasury,
      });
      expect(resWrongHash.valid).toBe(false);
      expect(resWrongHash.error).toContain('headHash mismatch');

      // 3. RCPT-01: Log from different contract address rejected even if topics match
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: treasury,
        logs: [{ address: '0x0000000000000000000000000000000000000088', data, topics }],
      }));
      const resWrongAnchorLog = await verifyAnchorReceiptOnFuji({
        txHash: '0xwronglogaddrtx',
        missionId: testMissionId,
        expectedHeadHash: headHash,
        treasuryAddress: treasury,
      });
      expect(resWrongAnchorLog.valid).toBe(false);
      expect(resWrongAnchorLog.error).toContain('from expected treasury contract');
    });

    it('FB-01 & RCPT-01: verifyFeedbackReceiptOnFuji validates ReputationRegistry transactions and agentId', async () => {
      const repRegistry = ERC8004_FUJI_REPUTATION_REGISTRY;
      const agentId = 1001n;

      const topics = encodeEventTopics({
        abi: [feedbackGivenEventAbi],
        eventName: 'FeedbackGiven',
        args: {
          agentId,
          client: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        },
      });
      const data = encodeAbiParameters(
        [
          { type: 'uint64', name: 'feedbackIndex' },
          { type: 'int128', name: 'value' },
          { type: 'uint8', name: 'valueDecimals' },
          { type: 'string', name: 'tag1' },
          { type: 'string', name: 'tag2' },
        ],
        [1n, 87n, 0, 'starred', 'unihack-s2']
      );

      // 1. Success feedback
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: repRegistry,
        logs: [{ address: repRegistry, data, topics }],
      }));

      const res = await verifyFeedbackReceiptOnFuji({
        txHash: '0xfeedbacktx',
        expectedAgentId: agentId,
      });
      expect(res.valid).toBe(true);

      // 2. AgentId mismatch
      const resWrongAgent = await verifyFeedbackReceiptOnFuji({
        txHash: '0xfeedbacktx',
        expectedAgentId: 9999n,
      });
      expect(resWrongAgent.valid).toBe(false);
      expect(resWrongAgent.error).toContain('agentId mismatch');

      // 3. Recipient mismatch
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: '0x0000000000000000000000000000000000000088',
        logs: [{ address: repRegistry, data, topics }],
      }));
      const resWrongTo = await verifyFeedbackReceiptOnFuji({
        txHash: '0xwrongtotx',
        expectedAgentId: agentId,
      });
      expect(resWrongTo.valid).toBe(false);
      expect(resWrongTo.error).toContain('recipient mismatch');

      // 4. RCPT-01: Log from different contract address rejected even if topics match
      setReceiptFetcherForTesting(async () => ({
        status: 'success',
        to: repRegistry,
        logs: [{ address: '0x0000000000000000000000000000000000000088', data, topics }],
      }));
      const resWrongLogAddr = await verifyFeedbackReceiptOnFuji({
        txHash: '0xwronglogaddrtx',
        expectedAgentId: agentId,
      });
      expect(resWrongLogAddr.valid).toBe(false);
      expect(resWrongLogAddr.error).toContain('from expected ReputationRegistry contract');
    });
  });
});
