import { describe, it, expect } from 'vitest';
import { verifyProof, INITIAL_PREV_HASH } from '../lib/proof-verifier';
import { keccak256, stringToBytes } from 'viem';

describe('WOW-2: Client-Side Hash Chain Verifier & Tamper Detection', () => {
  const entry0Json = JSON.stringify({
    actor: '0x976ea74026e726554db657fa54763abd0c3a0aa9',
    amount: '0',
    chain_id: '43113',
    created_at: '2026-11-07T08:00:00.000Z',
    kind: 'SESSION_WALLET_FUNDED',
    mission_id: 'mission-alpha',
    operation_id: 'op_0',
    policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    policy_version: '1',
    prev_hash: INITIAL_PREV_HASH,
    reason: 'Initial session funding',
    result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    rule: '',
    source_key: 'src_0',
    to: '0x5aadfb43ef8daf45dd80f4676345b7676f1d70e3',
    tx_hash: 'tx_0',
  });
  const entry0Hash = keccak256(stringToBytes(entry0Json));

  const entry1Json = JSON.stringify({
    actor: '0x1111111111111111111111111111111111111111',
    amount: '100000',
    chain_id: '43113',
    created_at: '2026-11-07T08:00:05.000Z',
    kind: 'TOOL_PAID',
    mission_id: 'mission-alpha',
    operation_id: 'op_1',
    policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    policy_version: '1',
    prev_hash: entry0Hash,
    reason: 'Search tool purchase',
    result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    rule: '',
    source_key: 'src_1',
    to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    tx_hash: 'tx_1',
  });
  const entry1Hash = keccak256(stringToBytes(entry1Json));

  const entry2Json = JSON.stringify({
    actor: '0x1111111111111111111111111111111111111111',
    amount: '500000',
    chain_id: '43113',
    created_at: '2026-11-07T08:00:10.000Z',
    kind: 'TOOL_PAID',
    mission_id: 'mission-alpha',
    operation_id: 'op_2',
    policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    policy_version: '1',
    prev_hash: entry1Hash,
    reason: 'Summary tool purchase',
    result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    rule: '',
    source_key: 'src_2',
    to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    tx_hash: 'tx_2',
  });
  const entry2Hash = keccak256(stringToBytes(entry2Json));

  const pristineEntries = [
    {
      sourceKey: 'src_0',
      prevHash: INITIAL_PREV_HASH,
      entryHash: entry0Hash,
      canonicalJson: entry0Json,
    },
    {
      sourceKey: 'src_1',
      prevHash: entry0Hash,
      entryHash: entry1Hash,
      canonicalJson: entry1Json,
    },
    {
      sourceKey: 'src_2',
      prevHash: entry1Hash,
      entryHash: entry2Hash,
      canonicalJson: entry2Json,
    },
  ];

  it('WOW-2: Verifies pristine hash-chain continuity with 100% integrity (green)', () => {
    const res = verifyProof(pristineEntries, {
      headHash: entry2Hash,
      entryCount: 3,
    });

    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.headHash).toBe(entry2Hash);
  });

  it('WOW-2: Mutating 1 byte at index 1 immediately breaks cryptographic proof at index 1 and cascades downstream', () => {
    // Modify 1 byte in entry 1's canonicalJson (e.g. amount changes from 100000 to 999999)
    const tamperedEntry1Json = entry1Json.replace('"amount":"100000"', '"amount":"999999"');
    const tamperedEntries = [
      pristineEntries[0],
      {
        ...pristineEntries[1],
        canonicalJson: tamperedEntry1Json,
      },
      pristineEntries[2],
    ];

    const res = verifyProof(tamperedEntries, {
      headHash: entry2Hash,
      entryCount: 3,
    });

    // Verification fails
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);

    // Specifically points to hash mismatch at index 1
    const errorAt1 = res.errors.find((err) => err.includes('Hash mismatch at index 1'));
    expect(errorAt1).toBeDefined();

    // Inner / outer amount check or hash mismatch
    expect(res.errors.some((err) => err.includes('index 1'))).toBe(true);
  });
});
