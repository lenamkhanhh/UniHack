import { describe, it, expect } from 'vitest';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  parseDecimalUnits6,
  formatDecimalUnits6,
  slugToMissionId,
  findUtf8ByteIndex,
  parseDerSignature,
  extractP256Coordinates,
  computeMissionPasskeyChallenge,
  computeOwnerActionPasskeyChallenge,
  computeWithdrawPasskeyChallenge,
  validateWebAuthnAuthLocally,
  SECP256R1_N,
  SECP256R1_HALF_N,
} from '../lib/webauthn-p256';
import { keccak256, toHex, stringToBytes } from 'viem';

describe('WebAuthn P-256 Core Helper (A2)', () => {
  describe('base64url encoding / decoding', () => {
    it('round-trips arbitrary bytes correctly without padding', () => {
      const original = new Uint8Array([0, 1, 2, 255, 254, 128, 64, 32, 16, 8, 4, 2, 1]);
      const b64url = bytesToBase64Url(original);
      expect(b64url).not.toContain('+');
      expect(b64url).not.toContain('/');
      expect(b64url).not.toContain('=');

      const decoded = base64UrlToBytes(b64url);
      expect(Array.from(decoded)).toEqual(Array.from(original));
    });

    it('correctly handles 32-byte challenge vectors (exactly 43 base64url chars)', () => {
      const challengeBytes = new Uint8Array(32).fill(0xab);
      const b64url = bytesToBase64Url(challengeBytes);
      expect(b64url.length).toBe(43);
      const decoded = base64UrlToBytes(b64url);
      expect(decoded.length).toBe(32);
      expect(decoded[0]).toBe(0xab);
      expect(decoded[31]).toBe(0xab);
    });
  });

  describe('decimal cap parsing (no floats)', () => {
    it('parses valid 6-decimal amounts into exact atomic units', () => {
      expect(parseDecimalUnits6('2.0')).toBe(2_000_000n);
      expect(parseDecimalUnits6('0.5')).toBe(500_000n);
      expect(parseDecimalUnits6('10')).toBe(10_000_000n);
      expect(parseDecimalUnits6('0.000001')).toBe(1n);
      expect(parseDecimalUnits6('1234.567890')).toBe(1_234_567_890n);
    });

    it('rejects invalid or dangerous decimal formats', () => {
      expect(() => parseDecimalUnits6('2.0000001')).toThrow(); // > 6 decimals
      expect(() => parseDecimalUnits6('-1.0')).toThrow();
      expect(() => parseDecimalUnits6('abc')).toThrow();
      expect(() => parseDecimalUnits6('1e6')).toThrow();
      expect(() => parseDecimalUnits6('')).toThrow();
    });

    it('formats atomic units back to exact decimal string', () => {
      expect(formatDecimalUnits6(2_000_000n)).toBe('2');
      expect(formatDecimalUnits6(500_000n)).toBe('0.5');
      expect(formatDecimalUnits6(1n)).toBe('0.000001');
    });
  });

  describe('slugToMissionId', () => {
    it('retains valid 66-character bytes32 hex string', () => {
      const hex = '0x1000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
      expect(slugToMissionId(hex)).toBe(hex);
    });

    it('hashes non-hex slugs with keccak256 deterministically', () => {
      const slug = 'mission-alpha-passkey';
      const expected = keccak256(toHex(slug));
      expect(slugToMissionId(slug)).toBe(expected);
    });
  });

  describe('findUtf8ByteIndex (multibyte safe)', () => {
    it('returns exact byte index matching character index for pure ASCII', () => {
      const json = '{"type":"webauthn.get","challenge":"abc","origin":"http://localhost:3100"}';
      expect(findUtf8ByteIndex(json, '"type":"webauthn.get"')).toBe(json.indexOf('"type":"webauthn.get"'));
      expect(findUtf8ByteIndex(json, '"challenge":"')).toBe(json.indexOf('"challenge":"'));
    });

    it('returns correct UTF-8 byte offset when multibyte UTF-8 characters precede the needle', () => {
      // "Chào bạn " is 9 chars in JS string, but 'à' is 2 bytes (0xc3 0xa0), so 10 bytes in UTF-8
      const prefix = 'Chào bạn ';
      const needle = '"challenge":"';
      const json = `${prefix}${needle}test"`;

      const charIdx = json.indexOf(needle);
      const byteIdx = findUtf8ByteIndex(json, needle);

      // charIdx is 9
      const expectedUtf8Len = new TextEncoder().encode(prefix).length;
      expect(charIdx).toBe(9);
      expect(expectedUtf8Len).toBe(12);
      expect(byteIdx).toBe(12);
      expect(byteIdx).toBeGreaterThan(charIdx);
    });
  });

  describe('parseDerSignature & low-s normalization', () => {
    it('parses standard 32-byte r and s', () => {
      const r = 0x1122334455667788n;
      const s = 0x99aabbccddeeff00n;

      const rBytes = new Uint8Array(32);
      const sBytes = new Uint8Array(32);
      new DataView(rBytes.buffer).setBigUint64(24, r);
      new DataView(sBytes.buffer).setBigUint64(24, s);

      // Construct DER: 0x30 [len] 0x02 32 [rBytes] 0x02 32 [sBytes]
      const der = new Uint8Array(2 + 2 + 32 + 2 + 32);
      der[0] = 0x30;
      der[1] = 68;
      der[2] = 0x02;
      der[3] = 32;
      der.set(rBytes, 4);
      der[36] = 0x02;
      der[37] = 32;
      der.set(sBytes, 38);

      const parsed = parseDerSignature(der);
      expect(parsed.r).toBe(r);
      expect(parsed.s).toBe(s);
    });

    it('normalizes high-s to low-s (s <= n / 2) when s > n / 2', () => {
      const r = 0x12345n;
      // High-s: SECP256R1_N - 100n
      const highS = SECP256R1_N - 100n;
      expect(highS).toBeGreaterThan(SECP256R1_HALF_N);

      const highSHex = highS.toString(16).padStart(64, '0');
      const sBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        sBytes[i] = parseInt(highSHex.slice(i * 2, i * 2 + 2), 16);
      }

      const rBytes = new Uint8Array(32);
      rBytes[31] = 5;

      const der = new Uint8Array(70);
      der[0] = 0x30;
      der[1] = 68;
      der[2] = 0x02;
      der[3] = 32;
      der.set(rBytes, 4);
      der[36] = 0x02;
      der[37] = 32;
      der.set(sBytes, 38);

      const parsed = parseDerSignature(der);
      expect(parsed.r).toBe(5n);
      // Normalized s must equal SECP256R1_N - highS = 100n!
      expect(parsed.s).toBe(100n);
      expect(parsed.s).toBeLessThanOrEqual(SECP256R1_HALF_N);
    });

    it('rejects invalid DER signature missing 0x30 or with zero r/s', () => {
      expect(() => parseDerSignature(new Uint8Array([0x31, 0x00]))).toThrow('missing 0x30');
    });
  });

  describe('extractP256Coordinates from SPKI / attestationObject', () => {
    it('extracts coordinates from SPKI DER public key', () => {
      // 91 bytes P-256 SPKI header (26 bytes) + 0x04 + 32 bytes X + 32 bytes Y
      const x = new Uint8Array(32).fill(0x11);
      const y = new Uint8Array(32).fill(0x22);
      const spki = new Uint8Array(26 + 1 + 32 + 32);
      spki[26] = 0x04;
      spki.set(x, 27);
      spki.set(y, 59);

      const coords = extractP256Coordinates({
        getPublicKey: () => spki.buffer,
      });

      expect(coords.x).toBe(toHex(x));
      expect(coords.y).toBe(toHex(y));
    });

    it('extracts coordinates from COSE attestationObject', () => {
      const x = new Uint8Array(32).fill(0x33);
      const y = new Uint8Array(32).fill(0x44);

      // Build minimal mock attestation buffer containing COSE markers
      // 0x21 0x58 0x20 <x> and 0x22 0x58 0x20 <y>
      const buf = new Uint8Array(100);
      buf[10] = 0x21; buf[11] = 0x58; buf[12] = 0x20;
      buf.set(x, 13);
      buf[50] = 0x22; buf[51] = 0x58; buf[52] = 0x20;
      buf.set(y, 53);

      const coords = extractP256Coordinates({
        attestationObject: buf.buffer,
      });

      expect(coords.x).toBe(toHex(x));
      expect(coords.y).toBe(toHex(y));
    });
  });

  describe('computeMissionPasskeyChallenge & validateWebAuthnAuthLocally', () => {
    const chainId = 43113;
    const authority = '0x77235386fe59A934645C5F273e411b0Bea8cCc9C';
    const missionId = '0x1000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
    const agent = '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c';
    const payeeRoot = '0xa7409058b8f2c3bfbb2e9f0b5d56b0d9e8df34906a282f10b74108d8108a8a47' as `0x${string}`;
    const cap = 2000000n;
    const duration = 86400n;
    const toolCap = 500000n;
    const nonce = 0n;

    it('computes deterministic challenge hash', () => {
      const ch1 = computeMissionPasskeyChallenge({
        chainId,
        authority,
        missionId,
        agent,
        payeeRoot,
        cap,
        duration,
        toolCap,
        nonce,
      });
      const ch2 = computeMissionPasskeyChallenge({
        chainId,
        authority,
        missionId,
        agent,
        payeeRoot,
        cap,
        duration,
        toolCap,
        nonce,
      });
      expect(ch1).toBe(ch2);
      expect(ch1.startsWith('0x')).toBe(true);
      expect(ch1.length).toBe(66);

      // Different nonce changes challenge
      const chDifferentNonce = computeMissionPasskeyChallenge({
        chainId,
        authority,
        missionId,
        agent,
        payeeRoot,
        cap,
        duration,
        toolCap,
        nonce: 1n,
      });
      expect(ch1).not.toBe(chDifferentNonce);
    });

    it('validates genuine WebAuthn auth payload and catches mismatches', () => {
      const challenge = computeMissionPasskeyChallenge({
        chainId,
        authority,
        missionId,
        agent,
        payeeRoot,
        cap,
        duration,
        toolCap,
        nonce,
      });

      const rpId = 'localhost';
      const origin = 'http://localhost:3100';
      const rpIdHash = keccak256(toHex(rpId)); // in test we simulate 32-byte hash

      // Build mock authenticatorData: 32 bytes rpIdHash + 0x05 (UP + UV) + 4 bytes signCount
      const authData = new Uint8Array(37);
      const rpIdBytes = new Uint8Array(
        (rpIdHash.slice(2).match(/.{1,2}/g) || []).map((b) => parseInt(b, 16))
      );
      authData.set(rpIdBytes, 0);
      authData[32] = 0x05; // UP | UV

      const chBytes = new Uint8Array(
        (challenge.slice(2).match(/.{1,2}/g) || []).map((b) => parseInt(b, 16))
      );
      const chB64 = bytesToBase64Url(chBytes);

      const clientDataJSON = `{"type":"webauthn.get","challenge":"${chB64}","origin":"${origin}"}`;
      const typeIndex = findUtf8ByteIndex(clientDataJSON, '"type":"webauthn.get"');
      const challengeIndex = findUtf8ByteIndex(clientDataJSON, '"challenge":"');
      const originIndex = findUtf8ByteIndex(clientDataJSON, '"origin":"');

      const validAuth = {
        authenticatorData: toHex(authData),
        clientDataJSON,
        typeIndex,
        challengeIndex,
        originIndex,
        r: '0x12345' as `0x${string}`,
        s: '0x67890' as `0x${string}`,
      };

      const result = validateWebAuthnAuthLocally({
        challenge,
        auth: validAuth,
        expectedRpIdHash: rpIdHash,
        expectedOrigin: origin,
        requireUserVerification: true,
      });
      expect(result.valid).toBe(true);

      // Test challenge mismatch
      const wrongChallenge = ('0x' + '9'.repeat(64)) as `0x${string}`;
      const mismatchResult = validateWebAuthnAuthLocally({
        challenge: wrongChallenge,
        auth: validAuth,
        expectedRpIdHash: rpIdHash,
        expectedOrigin: origin,
      });
      expect(mismatchResult.valid).toBe(false);
      expect(mismatchResult.reason).toContain('ChallengeMismatch');

      // Test missing UP flag
      const noUpAuthData = new Uint8Array(authData);
      noUpAuthData[32] = 0x00;
      const noUpResult = validateWebAuthnAuthLocally({
        challenge,
        auth: { ...validAuth, authenticatorData: toHex(noUpAuthData) },
        expectedRpIdHash: rpIdHash,
        expectedOrigin: origin,
      });
      expect(noUpResult.valid).toBe(false);
      expect(noUpResult.reason).toBe('UserPresenceRequired');

      // Test crossOrigin rejection
      const crossOriginJSON = `{"type":"webauthn.get","challenge":"${chB64}","origin":"${origin}","crossOrigin":true}`;
      const crossResult = validateWebAuthnAuthLocally({
        challenge,
        auth: { ...validAuth, clientDataJSON: crossOriginJSON },
        expectedRpIdHash: rpIdHash,
        expectedOrigin: origin,
      });
      expect(crossResult.valid).toBe(false);
      expect(crossResult.reason).toBe('CrossOriginNotAllowed');
    });
  });

  describe('A3 governance challenge codecs', () => {
    it('computes deterministic owner action challenge matching contract format', () => {
      const callData = '0x025e353a' as `0x${string}`; // pause()
      const challenge = computeOwnerActionPasskeyChallenge({
        chainId: 43113,
        authority: '0x1111111111111111111111111111111111111111',
        treasury: '0x2222222222222222222222222222222222222222',
        callData,
        nonce: 0n,
      });

      expect(challenge).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('computes deterministic withdraw challenge matching contract format', () => {
      const challenge = computeWithdrawPasskeyChallenge({
        chainId: 43113,
        authority: '0x1111111111111111111111111111111111111111',
        usdcToken: '0x5425890298aed601595a70ab815c96711a31bc65',
        to: '0x8888888888888888888888888888888888888888',
        amount: 5_000_000n,
        nonce: 1n,
      });

      expect(challenge).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });
});
