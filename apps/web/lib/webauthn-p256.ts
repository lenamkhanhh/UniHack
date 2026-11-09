import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toHex,
  parseUnits,
  formatUnits,
  isHex,
  isAddress,
  Hex,
} from 'viem';

// secp256r1 curve order n
export const SECP256R1_N =
  0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
export const SECP256R1_HALF_N = SECP256R1_N / 2n;

export interface WebAuthnAuthPayload {
  authenticatorData: `0x${string}`;
  clientDataJSON: string;
  challengeIndex: number;
  typeIndex: number;
  originIndex: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

export interface P256Coordinates {
  x: `0x${string}`;
  y: `0x${string}`;
  rawPublicKey: `0x${string}`;
}

/**
 * Base64URL to Uint8Array decoder
 */
export function base64UrlToBytes(base64url: string): Uint8Array {
  if (!base64url) return new Uint8Array(0);
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Uint8Array to Base64URL string encoder
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Extracts P-256 public key (x, y) coordinates from registration response.
 * Supports:
 * 1. credential.response.getPublicKey() (SPKI DER format, standard in modern browsers)
 * 2. credential.response.attestationObject (CBOR COSE key parsing)
 */
export function extractP256Coordinates(response: {
  getPublicKey?: () => ArrayBuffer | null;
  attestationObject?: ArrayBuffer | null;
}): P256Coordinates {
  // Option 1: Modern getPublicKey() -> SPKI DER
  if (typeof response.getPublicKey === 'function') {
    try {
      const spkiBuf = response.getPublicKey();
      if (spkiBuf && spkiBuf.byteLength >= 65) {
        const spkiBytes = new Uint8Array(spkiBuf);
        // Look for uncompressed EC point header 0x04 with 64 remaining bytes
        // In standard SPKI for P-256, uncompressed point (0x04 || 32 bytes X || 32 bytes Y) is at the end
        if (spkiBytes.length >= 65 && spkiBytes[spkiBytes.length - 65] === 0x04) {
          const xBytes = spkiBytes.slice(spkiBytes.length - 64, spkiBytes.length - 32);
          const yBytes = spkiBytes.slice(spkiBytes.length - 32);
          const rawBytes = spkiBytes.slice(spkiBytes.length - 65);
          return {
            x: toHex(xBytes),
            y: toHex(yBytes),
            rawPublicKey: toHex(rawBytes),
          };
        }
      }
    } catch {
      // Fallback to attestationObject
    }
  }

  // Option 2: Parse attestationObject (CBOR authData -> COSE key)
  if (response.attestationObject) {
    const attestationBytes = new Uint8Array(response.attestationObject);
    return parseP256FromAttestationObject(attestationBytes);
  }

  throw new Error('Could not extract P-256 public key: neither SPKI nor attestationObject available');
}

/**
 * Parses COSE P-256 public key coordinates from CBOR-encoded attestationObject
 */
export function parseP256FromAttestationObject(bytes: Uint8Array): P256Coordinates {
  // In CBOR attestationObject, look for "authData" key
  // "authData" text string in CBOR is 0x68 followed by 'authData' (8 bytes)
  const authDataHeader = new Uint8Array([0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61]);
  let authDataIdx = -1;
  for (let i = 0; i <= bytes.length - authDataHeader.length; i++) {
    let match = true;
    for (let j = 0; j < authDataHeader.length; j++) {
      if (bytes[i + j] !== authDataHeader[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      authDataIdx = i + authDataHeader.length;
      break;
    }
  }

  if (authDataIdx === -1) {
    // If authData text not found directly, scan entire byte stream for COSE P-256 markers
    return scanForCoseCoordinates(bytes);
  }

  // After "authData" key comes byte string: 0x58 <len> or 0x59 <len_hi> <len_lo>
  let authDataStart = authDataIdx;
  if (bytes[authDataStart] === 0x58) {
    authDataStart += 2;
  } else if (bytes[authDataStart] === 0x59) {
    authDataStart += 3;
  } else if ((bytes[authDataStart] & 0xe0) === 0x40) {
    authDataStart += 1;
  }

  // Inside authData:
  // rpIdHash: 32 bytes (offset 0)
  // flags: 1 byte (offset 32)
  // signCount: 4 bytes (offset 33)
  // If attested credential data present (flags bit 6 set, 0x40):
  // aaguid: 16 bytes (offset 37)
  // credentialIdLength: 2 bytes (offset 53)
  const flags = bytes[authDataStart + 32];
  if ((flags & 0x40) === 0) {
    throw new Error('AttestationObject does not contain attested credential data (flag 0x40 missing)');
  }

  const credIdLen = (bytes[authDataStart + 53] << 8) | bytes[authDataStart + 54];
  const coseKeyStart = authDataStart + 55 + credIdLen;
  const coseSlice = bytes.slice(coseKeyStart);

  return scanForCoseCoordinates(coseSlice);
}

/**
 * Scans a byte buffer for COSE EC2 P-256 X (-2) and Y (-3) coordinates.
 * In CBOR:
 * Key -2 is encoded as 0x21, followed by 32-byte byte string (0x58, 0x20, <32 bytes>)
 * Key -3 is encoded as 0x22, followed by 32-byte byte string (0x58, 0x20, <32 bytes>)
 */
function scanForCoseCoordinates(slice: Uint8Array): P256Coordinates {
  let xBytes: Uint8Array | null = null;
  let yBytes: Uint8Array | null = null;

  for (let i = 0; i <= slice.length - 35; i++) {
    // Check for Key -2 (X): 0x21 0x58 0x20 <32 bytes>
    if (slice[i] === 0x21 && slice[i + 1] === 0x58 && slice[i + 2] === 0x20) {
      xBytes = slice.slice(i + 3, i + 35);
    }
    // Check for Key -3 (Y): 0x22 0x58 0x20 <32 bytes>
    if (slice[i] === 0x22 && slice[i + 1] === 0x58 && slice[i + 2] === 0x20) {
      yBytes = slice.slice(i + 3, i + 35);
    }
  }

  if (!xBytes || !yBytes) {
    throw new Error('Failed to find P-256 (x, y) COSE keys in attestation data');
  }

  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(xBytes, 1);
  raw.set(yBytes, 33);

  return {
    x: toHex(xBytes),
    y: toHex(yBytes),
    rawPublicKey: toHex(raw),
  };
}

/**
 * Parses ASN.1 DER signature into (r, s) and normalizes high-s for secp256r1.
 * DER signature layout:
 * 0x30 <totalLen>
 *   0x02 <rLen> <rBytes>
 *   0x02 <sLen> <sBytes>
 */
export function parseDerSignature(signatureBytes: Uint8Array): {
  r: bigint;
  s: bigint;
  rHex: `0x${string}`;
  sHex: `0x${string}`;
} {
  if (signatureBytes.length < 8 || signatureBytes[0] !== 0x30) {
    throw new Error('Invalid ASN.1 DER signature: missing 0x30 sequence tag');
  }

  let offset = 2; // skip tag 0x30 and sequence length byte
  // Handle multi-byte length if highest bit is set
  if (signatureBytes[1] & 0x80) {
    const lenBytes = signatureBytes[1] & 0x7f;
    offset = 2 + lenBytes;
  }

  // Parse r (tag 0x02)
  if (signatureBytes[offset] !== 0x02) {
    throw new Error('Invalid ASN.1 DER signature: expected 0x02 tag for r');
  }
  const rLen = signatureBytes[offset + 1];
  offset += 2;
  const rBytes = signatureBytes.slice(offset, offset + rLen);
  offset += rLen;

  // Parse s (tag 0x02)
  if (signatureBytes[offset] !== 0x02) {
    throw new Error('Invalid ASN.1 DER signature: expected 0x02 tag for s');
  }
  const sLen = signatureBytes[offset + 1];
  offset += 2;
  const sBytes = signatureBytes.slice(offset, offset + sLen);

  const rBig = bytesToBigInt(rBytes);
  let sBig = bytesToBigInt(sBytes);

  if (rBig === 0n || rBig >= SECP256R1_N) {
    throw new Error(`Invalid signature r: out of secp256r1 bounds (r = ${rBig})`);
  }

  // Low-s normalization for secp256r1 (protects against signature malleability)
  if (sBig > SECP256R1_HALF_N) {
    sBig = SECP256R1_N - sBig;
  }

  if (sBig === 0n || sBig > SECP256R1_HALF_N) {
    throw new Error(`Invalid signature s: out of secp256r1 bounds (s = ${sBig})`);
  }

  const rHex = (`0x${rBig.toString(16).padStart(64, '0')}`) as `0x${string}`;
  const sHex = (`0x${sBig.toString(16).padStart(64, '0')}`) as `0x${string}`;

  return { r: rBig, s: sBig, rHex, sHex };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return BigInt(`0x${hex || '0'}`);
}

/**
 * Finds exact UTF-8 byte index of a substring within a string.
 * Essential for WebAuthn clientDataJSON verification in EVM contracts,
 * avoiding UTF-16 code unit offset errors when unicode or multibyte characters are present.
 */
export function findUtf8ByteIndex(fullString: string, needle: string): number {
  const charIndex = fullString.indexOf(needle);
  if (charIndex < 0) return -1;
  const sliceBefore = fullString.slice(0, charIndex);
  return new TextEncoder().encode(sliceBefore).length;
}

/**
 * Computes canonical mission passkey challenge hash matching PasskeyMissionAuthority.sol:
 * keccak256(abi.encode(
 *   "MissionPay-passkey-v1",
 *   block.chainid,
 *   address(this),
 *   missionId,
 *   agent,
 *   payeeRoot,
 *   cap,
 *   duration,
 *   toolCap,
 *   nonce
 * ))
 */
export function computeMissionPasskeyChallenge(params: {
  chainId: number | bigint;
  authority: string;
  missionId: `0x${string}`;
  agent: string;
  payeeRoot: `0x${string}`;
  cap: bigint;
  duration: bigint;
  toolCap: bigint;
  nonce: bigint;
}): `0x${string}` {
  const encoded = encodeAbiParameters(
    parseAbiParameters('string, uint256, address, bytes32, address, bytes32, uint256, uint256, uint256, uint256'),
    [
      'MissionPay-passkey-v1',
      BigInt(params.chainId),
      params.authority as `0x${string}`,
      params.missionId,
      params.agent as `0x${string}`,
      params.payeeRoot,
      params.cap,
      params.duration,
      params.toolCap,
      params.nonce,
    ]
  );
  return keccak256(encoded);
}

/**
 * Canonical missionId generator:
 * - If already a 32-byte hex string (0x + 64 hex chars), return normalized.
 * - Otherwise keccak256(toHex(slug)).
 */
export function slugToMissionId(slugOrHex: string): `0x${string}` {
  const trimmed = slugOrHex.trim();
  if (trimmed.startsWith('0x') && trimmed.length === 66) {
    return trimmed.toLowerCase() as `0x${string}`;
  }
  return keccak256(toHex(trimmed));
}

/**
 * Parses exact 6-decimal string (e.g. "2.5" -> 2500000n) without floating-point math.
 */
export function parseDecimalUnits6(amountStr: string): bigint {
  const clean = amountStr.trim();
  if (!clean || !/^\d+(\.\d{1,6})?$/.test(clean)) {
    throw new Error(`Invalid 6-decimal USDC amount string: "${amountStr}"`);
  }
  return parseUnits(clean, 6);
}

/**
 * Formats 6-decimal atomic units back to decimal string.
 */
export function formatDecimalUnits6(atomic: bigint): string {
  return formatUnits(atomic, 6);
}

/**
 * Local simulation & validation of WebAuthnAuth struct parameters
 * strictly mirroring PasskeyMissionAuthority.sol requirements.
 */
export function validateWebAuthnAuthLocally(params: {
  challenge: `0x${string}`;
  auth: WebAuthnAuthPayload;
  expectedRpIdHash: `0x${string}`;
  expectedOrigin: string;
  requireUserVerification?: boolean;
}): { valid: boolean; reason?: string } {
  const { auth, challenge, expectedRpIdHash, expectedOrigin, requireUserVerification } = params;

  if (!auth.authenticatorData || !isHex(auth.authenticatorData)) {
    return { valid: false, reason: 'Invalid or missing authenticatorData hex' };
  }

  const authDataBytes = base64UrlToBytes(bytesToBase64Url(new Uint8Array(
    (auth.authenticatorData.slice(2).match(/.{1,2}/g) || []).map((b) => parseInt(b, 16))
  )));

  // 1. Check length >= 37
  if (authDataBytes.length < 37) {
    return { valid: false, reason: 'InvalidAuthenticatorDataLength: must be >= 37 bytes' };
  }

  // 2. RP ID hash in authenticatorData[0:32]
  const rpIdHashInAuth = toHex(authDataBytes.slice(0, 32));
  if (rpIdHashInAuth.toLowerCase() !== expectedRpIdHash.toLowerCase()) {
    return { valid: false, reason: `InvalidRpIdHash: expected ${expectedRpIdHash}, got ${rpIdHashInAuth}` };
  }

  // 3. UP flag (bit 0 of byte 32)
  if ((authDataBytes[32] & 0x01) === 0) {
    return { valid: false, reason: 'UserPresenceRequired' };
  }

  // 4. UV flag (bit 2 of byte 32) if required
  if (requireUserVerification && (authDataBytes[32] & 0x04) === 0) {
    return { valid: false, reason: 'UserVerificationRequired' };
  }

  // 5. clientDataJSON validation
  if (!auth.clientDataJSON) {
    return { valid: false, reason: 'Missing clientDataJSON' };
  }

  const clientBytes = new TextEncoder().encode(auth.clientDataJSON);

  // Type check
  const expectedType = new TextEncoder().encode('"type":"webauthn.get"');
  if (auth.typeIndex + expectedType.length > clientBytes.length) {
    return { valid: false, reason: 'TypeIndexOutOfBounds' };
  }
  for (let i = 0; i < expectedType.length; i++) {
    if (clientBytes[auth.typeIndex + i] !== expectedType[i]) {
      return { valid: false, reason: 'InvalidWebAuthnType' };
    }
  }

  // Challenge check
  // WebAuthn base64url challenge
  const challengeRawBytes = new Uint8Array(
    (challenge.slice(2).match(/.{1,2}/g) || []).map((b) => parseInt(b, 16))
  );
  const expectedChallengeB64 = bytesToBase64Url(challengeRawBytes);
  const expectedChallengePattern = new TextEncoder().encode(`"challenge":"${expectedChallengeB64}"`);

  if (auth.challengeIndex + expectedChallengePattern.length > clientBytes.length) {
    return { valid: false, reason: 'ChallengeIndexOutOfBounds' };
  }
  for (let i = 0; i < expectedChallengePattern.length; i++) {
    if (clientBytes[auth.challengeIndex + i] !== expectedChallengePattern[i]) {
      return { valid: false, reason: 'ChallengeMismatch' };
    }
  }

  // Origin check
  const expectedOriginPattern = new TextEncoder().encode(`"origin":"${expectedOrigin}"`);
  if (auth.originIndex + expectedOriginPattern.length > clientBytes.length) {
    return { valid: false, reason: 'OriginIndexOutOfBounds' };
  }
  for (let i = 0; i < expectedOriginPattern.length; i++) {
    if (clientBytes[auth.originIndex + i] !== expectedOriginPattern[i]) {
      return { valid: false, reason: 'OriginMismatch' };
    }
  }

  // CrossOrigin check
  if (auth.clientDataJSON.includes('"crossOrigin":true') || auth.clientDataJSON.includes('"crossOrigin": true')) {
    return { valid: false, reason: 'CrossOriginNotAllowed' };
  }

  // Low-s and r bounds check
  const r = BigInt(auth.r);
  const s = BigInt(auth.s);
  if (r <= 0n || r >= SECP256R1_N) {
    return { valid: false, reason: 'InvalidSignatureR' };
  }
  if (s <= 0n || s > SECP256R1_HALF_N) {
    return { valid: false, reason: 'InvalidSignatureS: must satisfy low-s (s <= n/2)' };
  }

  return { valid: true };
}
