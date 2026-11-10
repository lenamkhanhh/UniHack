import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST, GET } from '../app/api/passkey/relay/route';
import { NextRequest } from 'next/server';
import { SECP256R1_N, SECP256R1_HALF_N } from '../lib/webauthn-p256';

describe('WOW-W4 / A2: Passkey Relay API (/api/passkey/relay)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PAYMENT_MODE = 'MOCK';
    process.env.PASSKEY_AUTHORITY_ADDRESS = '0x77235386fe59A934645C5F273e411b0Bea8cCc9C';
    delete process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS;
    process.env.AVALANCHE_FUJI_RPC_URL = 'https://api.avax-test.network/ext/bc/C/rpc';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects requests missing required WebAuthn or mission parameters with 400', async () => {
    const req = new NextRequest('http://localhost/api/passkey/relay', {
      method: 'POST',
      body: JSON.stringify({
        missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Thiếu tham số');
  });

  it('rejects invalid missionId or agent address with 400', async () => {
    const req = new NextRequest('http://localhost/api/passkey/relay', {
      method: 'POST',
      body: JSON.stringify({
        missionId: 'not-a-32-byte-hex',
        agent: 'invalid-address',
        payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
        cap: 2000000,
        duration: 86400,
        toolCap: 500000,
        nonce: 0,
        auth: {
          authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
          clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
          challengeIndex: 36,
          typeIndex: 10,
          originIndex: 50,
          r: '0x01',
          s: '0x01',
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('rejects high-s signature malleability with 400 and UNVERIFIED status', async () => {
    const highS = (SECP256R1_N - 5n).toString();
    const req = new NextRequest('http://localhost/api/passkey/relay', {
      method: 'POST',
      body: JSON.stringify({
        missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
        agent: '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c',
        payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
        cap: 2000000,
        duration: 86400,
        toolCap: 500000,
        nonce: 0,
        auth: {
          authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
          clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
          challengeIndex: 36,
          typeIndex: 10,
          originIndex: 50,
          r: '0x01',
          s: highS,
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.status).toBe('UNVERIFIED');
    expect(json.error).toContain('low-s');
  });

  it('in simulateOnly mode, returns UNVERIFIED with honest error when simulation reverts (no fake gas)', async () => {
    const req = new NextRequest('http://localhost/api/passkey/relay', {
      method: 'POST',
      body: JSON.stringify({
        missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
        agent: '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c',
        payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
        cap: 2000000,
        duration: 86400,
        toolCap: 500000,
        nonce: 0,
        auth: {
          authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
          clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
          challengeIndex: 36,
          typeIndex: 10,
          originIndex: 50,
          r: '0x01',
          s: '0x01',
        },
        simulateOnly: true,
      }),
    });

    const res = await POST(req);
    const json = await res.json();
    // Simulation should either succeed if valid or fail with UNVERIFIED (never hardcoded 281498)
    expect(json.simulated).toBe(true);
    expect(json.gasEstimated).not.toBe('281498');
    if (!json.success) {
      expect(json.status).toBe('UNVERIFIED');
      expect(res.status).toBe(422);
    } else {
      expect(json.status).toBe('SIMULATION_SUCCESS');
    }
  });

  it('A2-R1: GET /api/passkey/relay returns 503 NOT_CONFIGURED when PASSKEY_AUTHORITY_ADDRESS is not set', async () => {
    const prevAuth = process.env.PASSKEY_AUTHORITY_ADDRESS;
    const prevPubAuth = process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS;
    delete process.env.PASSKEY_AUTHORITY_ADDRESS;
    delete process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS;

    try {
      const res = await GET();
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.status).toBe('NOT_CONFIGURED');
    } finally {
      if (prevAuth) process.env.PASSKEY_AUTHORITY_ADDRESS = prevAuth;
      if (prevPubAuth) process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS = prevPubAuth;
    }
  });

  it('A2-R1: GET /api/passkey/relay returns 503 UNAVAILABLE when RPC/contract read fails (no fake fallback)', async () => {
    process.env.PASSKEY_AUTHORITY_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.AVALANCHE_FUJI_RPC_URL = 'http://127.0.0.1:54321/offline-rpc';

    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.status).toBe('UNAVAILABLE');
    expect(json.error).toContain('Failed reading on-chain authority configuration');
  });

  it('A2-R1: POST /api/passkey/relay returns 503 NOT_CONFIGURED when PASSKEY_AUTHORITY_ADDRESS is not set (no old deployment fallback)', async () => {
    const prevAuth = process.env.PASSKEY_AUTHORITY_ADDRESS;
    const prevPubAuth = process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS;
    delete process.env.PASSKEY_AUTHORITY_ADDRESS;
    delete process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS;

    try {
      const req = new NextRequest('http://localhost/api/passkey/relay', {
        method: 'POST',
        body: JSON.stringify({
          missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
          agent: '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c',
          payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
          cap: 2000000,
          duration: 86400,
          toolCap: 500000,
          nonce: 0,
          auth: {
            authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
            clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
            challengeIndex: 36,
            typeIndex: 10,
            originIndex: 50,
            r: '0x01',
            s: '0x01',
          },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.status).toBe('NOT_CONFIGURED');
    } finally {
      if (prevAuth) process.env.PASSKEY_AUTHORITY_ADDRESS = prevAuth;
      if (prevPubAuth) process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS = prevPubAuth;
    }
  });

  it('A2-R1: POST /api/passkey/relay returns 503 NOT_CONFIGURED when authority is missing', async () => {
    delete process.env.PASSKEY_AUTHORITY_ADDRESS;
    delete process.env.NEXT_PUBLIC_PASSKEY_AUTHORITY_ADDRESS;

    const req = new NextRequest('http://localhost/api/passkey/relay', {
      method: 'POST',
      body: JSON.stringify({
        missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
        agent: '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c',
        payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
        cap: 2000000,
        duration: 86400,
        toolCap: 500000,
        nonce: 0,
        auth: {
          authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
          clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
          challengeIndex: 36,
          typeIndex: 10,
          originIndex: 50,
          r: '0x01',
          s: '0x01',
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.status).toBe('NOT_CONFIGURED');
    expect(json.error).toContain('PASSKEY_AUTHORITY_ADDRESS is not configured');
  });

  it('A2-R1: POST /api/passkey/relay returns 503 UNAVAILABLE when RPC chainId read fails (no silent 43113 fallback)', async () => {
    process.env.PASSKEY_AUTHORITY_ADDRESS = '0x1111111111111111111111111111111111111111';
    process.env.AVALANCHE_FUJI_RPC_URL = 'http://127.0.0.1:54321/offline-rpc';

    const req = new NextRequest('http://localhost/api/passkey/relay', {
      method: 'POST',
      body: JSON.stringify({
        missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
        agent: '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c',
        payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
        cap: 2000000,
        duration: 86400,
        toolCap: 500000,
        nonce: 0,
        auth: {
          authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
          clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
          challengeIndex: 36,
          typeIndex: 10,
          originIndex: 50,
          r: '0x01',
          s: '0x01',
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.status).toBe('UNAVAILABLE');
    expect(json.error).toContain('Failed reading chainId');
  });

  it('W4-F1: returns 503 if RELAYER_PRIVATE_KEY is missing when not in simulation mode', async () => {
    delete process.env.PAYMENT_MODE;
    const prevRelayerKey = process.env.RELAYER_PRIVATE_KEY;
    delete process.env.RELAYER_PRIVATE_KEY;

    try {
      const req = new NextRequest('http://localhost/api/passkey/relay', {
        method: 'POST',
        body: JSON.stringify({
          missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
          agent: '0x374b8A126FDb9e5deEc8307da385076155Af3D72',
          payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
          cap: 2000000,
          duration: 86400,
          toolCap: 500000,
          nonce: 0,
          auth: {
            authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
            clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
            challengeIndex: 36,
            typeIndex: 10,
            originIndex: 50,
            r: '0x01',
            s: '0x01',
          },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Relayer service not configured');
    } finally {
      if (prevRelayerKey) process.env.RELAYER_PRIVATE_KEY = prevRelayerKey;
    }
  });

  it('W4-F1: refuses execution with 500 if relayer address matches OWNER_ADDRESS', async () => {
    delete process.env.PAYMENT_MODE;
    const testPrivKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
    process.env.RELAYER_PRIVATE_KEY = testPrivKey;
    const prevOwner = process.env.OWNER_ADDRESS;
    process.env.OWNER_ADDRESS = '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1';

    try {
      const req = new NextRequest('http://localhost/api/passkey/relay', {
        method: 'POST',
        body: JSON.stringify({
          missionId: '0x1000000000000000000000000000000000000000000000000000000000000001',
          agent: '0x374b8A126FDb9e5deEc8307da385076155Af3D72',
          payeeRoot: '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47',
          cap: 2000000,
          duration: 86400,
          toolCap: 500000,
          nonce: 0,
          auth: {
            authenticatorData: '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f200100000001',
            clientDataJSON: '{"type":"webauthn.get","challenge":"test","origin":"http://localhost:3100"}',
            challengeIndex: 36,
            typeIndex: 10,
            originIndex: 50,
            r: '0x01',
            s: '0x01',
          },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Security violation: Relayer cannot be owner address');
    } finally {
      process.env.OWNER_ADDRESS = prevOwner;
    }
  });
});
