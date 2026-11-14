import { describe, it, expect } from 'vitest';
import { Hex } from 'viem';
import {
  packWarpMessagePredicate,
  unpackWarpMessagePredicate,
} from '../../../scripts/m9-self-relay';

describe('M9 Self-Relay Predicate Packing & Integrity Tests', () => {
  // Real 917-byte signed message vector obtained from Dispatch block 32002 tx 0x8900385adadbdc5d2219990cf1e4f7a37a0ba1d0d685e5a4cc9572d741a3cf21
  // via public Ava Labs Glacier Signature Aggregator (public testnet message, contains 0 secrets)
  const KNOWN_SIGNED_MESSAGE_VECTOR =
    '0x0000000000059f3be606497285d0ffbb5ac9ba24aa60346a9b1812479ed66cb329f394a4b1c70000030200000000000100000014f7cbd95f1355f0d8d659864b92e2e9fbfab786f7000002e000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000001acf0000000000000000000000004abb50eb8496b572a3873f0ea562bfaf6f09f9cd7fc93d85c6d62c5b2ac0b519c87010ea5294012d1e407030d6acd0021cac10d50000000000000000000000004abb50eb8496b572a3873f0ea562bfaf6f09f9cd00000000000000000000000000000000000000000000000000000000000493e00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000014260000000000000000000000007ec2afb0a06a73666adc24983ebdbf2b6f1d708200000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c07fc93d85c6d62c5b2ac0b519c87010ea5294012d1e407030d6acd0021cac10d50000000000000000000000004abb50eb8496b572a3873f0ea562bfaf6f09f9cd0000000000000000000000006f419e35a60439569640ca078ba5e86599e30cc60000000000000000000000005e8df2ffd66203fb7df58240fe91b477455377cb00000000000000000000000000000000000000000000000002c68af0bb14000000000000000000000000000000000000000000000000000000000000000000000000000000000001038aabd8b7285f254ae58fce733c4bbd9c477b2d16e20a56471fdf5470747ac9558aa7b52c275016bb8fdf42fa28920cc216088aec1ea51fbbb31ea69333bbd86ba8734a12280be2bf14056dffc1dcba6b486b89af5ca98485fae2a935409b8d12' as Hex;

  it('packs known 917-byte signed vector to exactly ceil((len+1)/32) = 29 storage keys', () => {
    const rawBytesLen = (KNOWN_SIGNED_MESSAGE_VECTOR.length - 2) / 2;
    expect(rawBytesLen).toBe(917);

    const storageKeys = packWarpMessagePredicate(KNOWN_SIGNED_MESSAGE_VECTOR);
    const expectedCount = Math.ceil((rawBytesLen + 1) / 32);

    expect(expectedCount).toBe(29);
    expect(storageKeys).toHaveLength(29);

    // Every storage key is a valid 32-byte hex string (66 chars including 0x)
    for (const key of storageKeys) {
      expect(key).toMatch(/^0x[0-9a-fA-F]{64}$/);
    }

    // Verify 0xff delimiter in the last storage key
    // Raw length = 917 bytes. 28 full 32-byte chunks = 896 bytes.
    // 917 - 896 = 21 bytes in the 29th chunk.
    // So byte 21 (0-indexed) in chunk 28 must be 0xff, followed by 10 zero bytes.
    const lastKey = storageKeys[storageKeys.length - 1];
    const lastChunkBytes = Buffer.from(lastKey.slice(2), 'hex');
    expect(lastChunkBytes[21]).toBe(0xff);
    for (let i = 22; i < 32; i++) {
      expect(lastChunkBytes[i]).toBe(0x00);
    }
  });

  it('verifies round-trip unpacking restores exact original bytes for known vector', () => {
    const storageKeys = packWarpMessagePredicate(KNOWN_SIGNED_MESSAGE_VECTOR);
    const unpacked = unpackWarpMessagePredicate(storageKeys);
    expect(unpacked.toLowerCase()).toBe(KNOWN_SIGNED_MESSAGE_VECTOR.toLowerCase());
  });

  it('verifies chunk count formula ceil((len+1)/32) across edge boundary lengths', () => {
    const testCases: { len: number; expectedChunks: number }[] = [
      { len: 0, expectedChunks: 1 }, // (0 + 1) / 32 -> 1
      { len: 1, expectedChunks: 1 }, // (1 + 1) / 32 -> 1
      { len: 30, expectedChunks: 1 }, // (30 + 1) / 32 -> 1
      { len: 31, expectedChunks: 1 }, // (31 + 1) / 32 -> 1 (31 bytes + 0xff = exactly 32 bytes)
      { len: 32, expectedChunks: 2 }, // (32 + 1) / 32 -> 2 (32 bytes in chunk 0, 0xff in chunk 1)
      { len: 33, expectedChunks: 2 }, // (33 + 1) / 32 -> 2
      { len: 63, expectedChunks: 2 }, // (63 + 1) / 32 -> 2 (63 bytes + 0xff = exactly 64 bytes)
      { len: 64, expectedChunks: 3 }, // (64 + 1) / 32 -> 3
      { len: 812, expectedChunks: 26 }, // Dispatch unsigned message length: ceil(813/32) = 26
      { len: 917, expectedChunks: 29 }, // Fuji signed message length: ceil(918/32) = 29
    ];

    for (const { len, expectedChunks } of testCases) {
      const dummyBytes = Buffer.alloc(len, 0x42);
      const hex = `0x${dummyBytes.toString('hex')}` as Hex;

      const keys = packWarpMessagePredicate(hex);
      expect(keys).toHaveLength(expectedChunks);

      const roundTrip = unpackWarpMessagePredicate(keys);
      expect(roundTrip.toLowerCase()).toBe(hex.toLowerCase());
    }
  });

  it('throws descriptive error if 0xff delimiter is missing in storage keys', () => {
    const invalidKeys: Hex[] = [
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    ];
    expect(() => unpackWarpMessagePredicate(invalidKeys)).toThrow(
      'Delimiter 0xff not found in storage keys'
    );
  });
});
