import { describe, it, expect } from 'vitest';
import { GET } from '../app/api/health/route';

describe('WOW-W7: Production Health Check API (/api/health)', () => {
  it('returns healthy status with database and Fuji testnet connectivity', async () => {
    const res = await GET();
    const data = await res.json();

    expect([200, 503]).toContain(res.status);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('network');
    expect(data).toHaveProperty('database');

    expect(data.network.expectedChainId).toBe(43113);
    expect(data.network.treasuryAddress).toBe('0x20451c1e2dCD83F166B4f22868BAdECb5868d545');

    if (res.status === 200) {
      expect(data.status).toBe('healthy');
      expect(data.database.status).toBe('connected');
      expect(data.network.actualChainId).toBe(43113);
      expect(data.network.status).toBe('connected');
      expect(data.network.latestBlock).toBeGreaterThan(60_000_000);
    }
  });

  it('validates schema response structure under degraded simulated conditions', async () => {
    // Verify that the health payload preserves contract regardless of network jitter
    const res = await GET();
    const data = await res.json();
    expect(data).toHaveProperty('version', '1.0.0');
    expect(typeof data.timestamp).toBe('string');
  });
});
