import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '../app/api/passkey/relay/route';
import { NextRequest } from 'next/server';

describe('WOW-W4: Passkey Relay API (/api/passkey/relay)', () => {
  const originalMode = process.env.PAYMENT_MODE;

  beforeEach(() => {
    process.env.PAYMENT_MODE = 'MOCK';
  });

  afterEach(() => {
    process.env.PAYMENT_MODE = originalMode;
  });

  it('rejects requests missing required WebAuthn or mission parameters with 400', async () => {
    const req = new NextRequest('http://localhost/api/passkey/relay', {
      method: 'POST',
      body: JSON.stringify({
        missionId: '0x123',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Thiếu tham số');
  });

  it('successfully processes valid passkey assertion in simulation mode', async () => {
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
          r: '0x01',
          s: '0x01',
        },
        simulateOnly: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.simulated).toBe(true);
    expect(json.gasEstimated).toBe('281498');
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
    // Private key corresponding to address 0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c or test key
    // Let's use a known test key and set OWNER_ADDRESS to that account address
    const testPrivKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d';
    // Address for testPrivKey is 0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1
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
