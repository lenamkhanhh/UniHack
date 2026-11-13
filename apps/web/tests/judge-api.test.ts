import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  fetchLiveReceipts,
  GET as getReceiptsRoute,
} from '../app/api/judge/receipts/route';
import {
  runJudgeSimulation,
  checkSimulateRateLimit,
  clearSimulateRateLimit,
  POST as simulateRoute,
  OWNER_ADDRESS,
  AGENT_ADDRESS,
  GUARDED_TREASURY_ADDRESS,
  MISSION_B_ID,
} from '../app/api/judge/simulate/route';

describe('Judge Mode API Routes (Round 13)', () => {
  beforeEach(() => {
    clearSimulateRateLimit();
  });

  describe('GET /api/judge/receipts', () => {
    it('returns exact receipt statuses and gas metrics from publicClient', async () => {
      const mockClient: any = {
        getTransactionReceipt: vi.fn().mockImplementation(async ({ hash }: { hash: string }) => {
          if (hash.includes('548d1106')) {
            return {
              status: 'success',
              blockNumber: 61001944n,
              gasUsed: 461740n,
              effectiveGasPrice: 157n,
              from: AGENT_ADDRESS,
              to: GUARDED_TREASURY_ADDRESS,
              transactionHash: hash,
            };
          }
          if (hash.includes('0ad53adc')) {
            return {
              status: 'reverted',
              blockNumber: 61001947n,
              gasUsed: 60000n,
              effectiveGasPrice: 157n,
              from: AGENT_ADDRESS,
              to: GUARDED_TREASURY_ADDRESS,
              transactionHash: hash,
            };
          }
          return {
            status: 'success',
            blockNumber: 61001949n,
            gasUsed: 406027n,
            effectiveGasPrice: 157n,
            from: AGENT_ADDRESS,
            to: GUARDED_TREASURY_ADDRESS,
            transactionHash: hash,
          };
        }),
      };

      const items = await fetchLiveReceipts(mockClient);
      expect(items).toHaveLength(3);

      // Mission A: Success
      expect(items[0].id).toBe('missionA');
      expect(items[0].status).toBe('success');
      expect(items[0].blockNumber).toBe(61001944);
      expect(items[0].gasUsed).toBe('461740');

      // Mission B Negative Control: Reverted on-chain
      expect(items[1].id).toBe('missionB_negative');
      expect(items[1].status).toBe('reverted');
      expect(items[1].revertReason).toBe('PayeeNotInMissionSet');
      expect(items[1].blockNumber).toBe(61001947);
      expect(items[1].gasUsed).toBe('60000');

      // Mission B Positive Control: Success
      expect(items[2].id).toBe('missionB_positive');
      expect(items[2].status).toBe('success');
      expect(items[2].blockNumber).toBe(61001949);
      expect(items[2].gasUsed).toBe('406027');
    });

    it('returns 502 with RPC_ERROR when Fuji RPC throws, never returning fake receipts', async () => {
      const mockFailingClient: any = {
        getTransactionReceipt: vi.fn().mockRejectedValue(new Error('RPC connection refused')),
      };

      await expect(fetchLiveReceipts(mockFailingClient)).rejects.toThrow('RPC connection refused');
    });
  });

  describe('POST /api/judge/simulate', () => {
    const mockSuccessClient: any = {
      readContract: vi.fn().mockResolvedValue([
        MISSION_B_ID,
        AGENT_ADDRESS,
        20000n,
        1797162248n, // Dec 13, 2026
        true,
      ]),
      call: vi.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000008'),
    };

    const mockRevertClient: any = {
      readContract: vi.fn().mockResolvedValue([
        MISSION_B_ID,
        AGENT_ADDRESS,
        20000n,
        1797162248n,
        true,
      ]),
      call: vi.fn().mockRejectedValue(new Error('execution reverted: PayeeNotInMissionSet')),
    };

    it('returns REVERT outcome and exact PayeeNotInMissionSet reason for off-mission payee', async () => {
      const result = await runJudgeSimulation(
        '0xDead000000000000000000000000000000000001',
        10000,
        mockRevertClient
      );

      expect(result.success).toBe(false);
      expect(result.outcome).toBe('REVERT');
      expect(result.revertReason).toBe('PayeeNotInMissionSet');
      expect(result.recipient.toLowerCase()).toBe('0xdead000000000000000000000000000000000001');
      expect(result.amountAtomic).toBe(10000);
      expect(result.amountUsdc).toBe('0.010000 USDC');
      expect(new Date(result.missionBExpiry).getTime()).toBeGreaterThan(Date.now());
    });

    it('returns SUCCESS outcome for legitimate owner payee with valid proof', async () => {
      const result = await runJudgeSimulation(OWNER_ADDRESS, 10000, mockSuccessClient);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('SUCCESS');
      expect(result.recipient.toLowerCase()).toBe(OWNER_ADDRESS.toLowerCase());
      expect(result.amountAtomic).toBe(10000);
      expect(result.amountUsdc).toBe('0.010000 USDC');
    });

    it('validates address input and throws INVALID_ADDRESS for malformed address', async () => {
      await expect(runJudgeSimulation('0xinvalid-address', 10000, mockSuccessClient)).rejects.toThrow(
        'INVALID_ADDRESS'
      );
      await expect(runJudgeSimulation('', 10000, mockSuccessClient)).rejects.toThrow(
        'INVALID_ADDRESS'
      );
    });

    it('validates amount input and throws INVALID_AMOUNT when amount > 10000 or <= 0', async () => {
      await expect(
        runJudgeSimulation(OWNER_ADDRESS, 10001, mockSuccessClient)
      ).rejects.toThrow('INVALID_AMOUNT');

      await expect(
        runJudgeSimulation(OWNER_ADDRESS, 0, mockSuccessClient)
      ).rejects.toThrow('INVALID_AMOUNT');

      await expect(
        runJudgeSimulation(OWNER_ADDRESS, -500, mockSuccessClient)
      ).rejects.toThrow('INVALID_AMOUNT');
    });

    it('enforces in-memory sliding window rate limit of 10 requests / minute per IP', () => {
      const testIp = '198.51.100.42';
      for (let i = 0; i < 10; i++) {
        expect(checkSimulateRateLimit(testIp, 10)).toBe(true);
      }
      // 11th request in the same minute must be rejected
      expect(checkSimulateRateLimit(testIp, 10)).toBe(false);

      // Separate IP is unaffected
      const otherIp = '198.51.100.43';
      expect(checkSimulateRateLimit(otherIp, 10)).toBe(true);
    });

    it('POST handler returns HTTP 400 for bad address', async () => {
      const req = new NextRequest('http://localhost:3000/api/judge/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: 'not-an-address', amountAtomic: 10000 }),
      });

      const res = await simulateRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('BAD_REQUEST');
      expect(data.message).toContain('Invalid Ethereum address');
    });

    it('POST handler returns HTTP 400 for amount > 10000', async () => {
      const req = new NextRequest('http://localhost:3000/api/judge/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: OWNER_ADDRESS, amountAtomic: 25000 }),
      });

      const res = await simulateRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('BAD_REQUEST');
      expect(data.message).toContain('Amount out of bounds');
    });

    it('POST handler returns HTTP 429 when rate limit is exceeded', async () => {
      const testIp = '203.0.113.99';
      for (let i = 0; i < 10; i++) {
        checkSimulateRateLimit(testIp, 10);
      }

      // 11th request from this IP
      process.env.TEST_CLIENT_IP_ENABLED = '1';
      const req = new NextRequest('http://localhost:3000/api/judge/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-client-ip': testIp,
        },
        body: JSON.stringify({ recipient: OWNER_ADDRESS, amountAtomic: 10000 }),
      });

      const res = await simulateRoute(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.error).toBe('QUOTA_EXCEEDED');
      delete process.env.TEST_CLIENT_IP_ENABLED;
    });

    it('fails closed and reports RPC_ERROR on network failure without fake data', async () => {
      const mockNetworkErrorClient: any = {
        readContract: vi.fn().mockRejectedValue({
          name: 'HttpRequestError',
          message: 'fetch failed: ECONNREFUSED',
        }),
      };

      await expect(
        runJudgeSimulation(OWNER_ADDRESS, 10000, mockNetworkErrorClient)
      ).rejects.toThrow('RPC_ERROR');
    });

    it('R13A-F2: RPC 429/500 rate limit / node errors throw RPC_ERROR and result in 502, NOT REVERT', async () => {
      // Mock an RPC node throwing HTTP 429 Too Many Requests
      const mockRpcRateLimitClient: any = {
        readContract: vi.fn().mockResolvedValue([
          MISSION_B_ID,
          AGENT_ADDRESS,
          20000n,
          1797162248n,
          true,
        ]),
        call: vi.fn().mockRejectedValue(new Error('HTTP 429 Too Many Requests: Rate limit exceeded on Avalanche RPC node')),
      };

      await expect(
        runJudgeSimulation(OWNER_ADDRESS, 10000, mockRpcRateLimitClient)
      ).rejects.toThrow('RPC_ERROR');
    });

    it('R13A-F1: returns missionBExpiry null when contract read fails, never returning typed date', async () => {
      const mockFailingExpiryClient: any = {
        readContract: vi.fn().mockRejectedValue(new Error('Unknown read error')),
        call: vi.fn().mockResolvedValue('0x0000000000000000000000000000000000000000000000000000000000000008'),
      };

      const res = await runJudgeSimulation(OWNER_ADDRESS, 10000, mockFailingExpiryClient);
      expect(res.success).toBe(true);
      expect(res.missionBExpiry).toBeNull();
    });
  });

  describe('Live Fuji RPC Integration (gated by FUJI_LIVE_TEST=1)', () => {
    const isLiveTest = process.env.FUJI_LIVE_TEST === '1';

    it.skipIf(!isLiveTest)(
      'LIVE FUJI: random address strictly reverts with PayeeNotInMissionSet',
      async () => {
        const randomAddr = '0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        const res = await runJudgeSimulation(randomAddr, 10000);
        expect(res.success).toBe(false);
        expect(res.outcome).toBe('REVERT');
        expect(res.revertReason).toContain('PayeeNotInMissionSet');
      },
      30000
    );

    it.skipIf(!isLiveTest)(
      'LIVE FUJI: owner address strictly succeeds with valid proof',
      async () => {
        const res = await runJudgeSimulation(OWNER_ADDRESS, 10000);
        expect(res.success).toBe(true);
        expect(res.outcome).toBe('SUCCESS');
      },
      30000
    );
  });
});
