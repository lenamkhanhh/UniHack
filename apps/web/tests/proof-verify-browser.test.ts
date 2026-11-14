import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { verifyProof, INITIAL_PREV_HASH } from '../lib/proof-verifier';
import { keccak256, stringToBytes } from 'viem';
import { setAnchorFetcherForTesting } from '../lib/config';

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

  it('WOW-F2: Random non-existent missionId returns 404, while demo-seed returns isSeededDemo: true with empty tx_hash', async () => {
    const { GET } = await import('../app/api/verify/[missionId]/route');

    // 1. Non-existent random missionId -> 404
    const reqRandom = new Request('http://localhost/api/verify/non-existent-random-id');
    const resRandom = await GET(reqRandom as any, { params: Promise.resolve({ missionId: 'non-existent-random-id' }) });
    expect(resRandom.status).toBe(404);
    const jsonRandom = await resRandom.json();
    expect(jsonRandom.error).toContain('Không tìm thấy mission');

    // 2. Fixed demo-seed -> 200, isSeededDemo: true, empty tx_hash, clean sandbox addresses
    const reqSeed = new Request('http://localhost/api/verify/demo-seed');
    const resSeed = await GET(reqSeed as any, { params: Promise.resolve({ missionId: 'demo-seed' }) });
    expect(resSeed.status).toBe(200);
    const jsonSeed = await resSeed.json();
    expect(jsonSeed.success).toBe(true);
    expect(jsonSeed.isSeededDemo).toBe(true);
    expect(jsonSeed.entries.length).toBe(3);

    // Verify all seed entries have empty tx_hash and valid hashes
    for (const e of jsonSeed.entries) {
      const parsed = JSON.parse(e.canonicalJson);
      expect(parsed.tx_hash).toBe('');
      // No Anvil addresses
      expect(parsed.actor.toLowerCase()).not.toContain('976ea740');
      expect(parsed.to.toLowerCase()).not.toContain('70997970');
    }

    // Client verifier passes on demo-seed chain
    const verifyRes = verifyProof(jsonSeed.entries);
    expect(verifyRes.valid).toBe(true);
  });

  describe('S1-F9: On-Chain Anchor & Client Head Comparison Integration', () => {
    const originalPaymentMode = process.env.PAYMENT_MODE;

    beforeEach(async () => {
      const { prisma } = await import('../lib/db');
      await prisma.mission.upsert({
        where: { slug: 'fuji-live-mission-s1b' },
        update: {
          publicPublished: true,
          status: 'CLOSED',
        },
        create: {
          slug: 'fuji-live-mission-s1b',
          missionId: '0xeb8f4a47323136c557439a5f0f90b73222f28b8725c0e4e480256621c10682f4',
          ownerAddress: '0x4bc93356c180ba2dd13a4a1cf43405bd0eb58f7c',
          agentAddress: '0x374b8a126fdb9e5deec8307da385076155af3d72',
          treasuryCap: '2000000',
          toolCap: '500000',
          spentTool: '0',
          reservedTool: '0',
          status: 'CLOSED',
          publicPublished: true,
          expiresAt: new Date(Date.now() + 86400000),
          payeesJson: '["0x1111111111111111111111111111111111111111"]',
          payeeRoot: '0xa7409058568815d08a7ad3c7d4fd44cf1dec90c620cb31e55ad24c654f7ba34f',
          configVersion: 1,
          policyHash: '0x35bad8ba756db51dc6337f5e293210fa3a4e511636987a56e26f256b5032c3da',
          auditHeadHash: entry2Hash,
          auditEntryCount: 3,
        },
      });

      const count = await prisma.auditEntry.count({
        where: { missionSlug: 'fuji-live-mission-s1b' },
      });
      if (count === 0) {
        for (let i = 0; i < pristineEntries.length; i++) {
          const pe = pristineEntries[i];
          await prisma.auditEntry.create({
            data: {
              missionSlug: 'fuji-live-mission-s1b',
              missionSequence: i + 1,
              sourceKey: pe.sourceKey,
              prevHash: pe.prevHash,
              entryHash: pe.entryHash,
              canonicalJson: pe.canonicalJson,
              createdAt: new Date(),
            },
          });
        }
      }
    });

    afterEach(() => {
      setAnchorFetcherForTesting(null);
      process.env.PAYMENT_MODE = originalPaymentMode;
    });

    afterAll(async () => {
      const { prisma } = await import('../lib/db');
      await prisma.auditEntry.deleteMany({
        where: { missionSlug: 'fuji-live-mission-s1b' },
      });
      await prisma.mission.deleteMany({
        where: { slug: 'fuji-live-mission-s1b' },
      });
    });

    it('S1-F9 (Test 1): Mission in MOCK mode or unanchored returns "Chưa neo on-chain"', async () => {
      process.env.PAYMENT_MODE = 'MOCK';
      setAnchorFetcherForTesting(null);

      const { GET } = await import('../app/api/verify/[missionId]/route');

      // 1. Seeded demo in MOCK mode
      const reqSeed = new Request('http://localhost/api/verify/demo-seed');
      const resSeed = await GET(reqSeed as any, { params: Promise.resolve({ missionId: 'demo-seed' }) });
      const jsonSeed = await resSeed.json();
      expect(jsonSeed.anchorStatus.anchored).toBe(false);
      expect(jsonSeed.anchorStatus.label).toContain('Chưa neo on-chain');

      // 2. Real mission in MOCK mode -> anchored must remain false
      const reqS1b = new Request('http://localhost/api/verify/fuji-live-mission-s1b');
      const resS1b = await GET(reqS1b as any, { params: Promise.resolve({ missionId: 'fuji-live-mission-s1b' }) });
      expect(resS1b.status).toBe(200);
      const jsonS1b = await resS1b.json();
      expect(jsonS1b.anchorStatus.anchored).toBe(false);
      expect(jsonS1b.anchorStatus.label).toContain('Chưa neo on-chain');
    });

    it('S1-F9 (Test 2): s1b with verified on-chain anchor matches client recomputed head (khớp 0x0169ce58… / on-chain)', async () => {
      process.env.PAYMENT_MODE = 'LIVE_FUJI';
      setAnchorFetcherForTesting(async () => entry2Hash);

      const { GET } = await import('../app/api/verify/[missionId]/route');
      const req = new Request('http://localhost/api/verify/fuji-live-mission-s1b');
      const res = await GET(req as any, { params: Promise.resolve({ missionId: 'fuji-live-mission-s1b' }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.anchorStatus.anchored).toBe(true);
      expect(json.anchorStatus.onchainHead?.toLowerCase()).toBe(entry2Hash.toLowerCase());

      // Client recomputed head matches onchain head 100%
      const clientRes = verifyProof(json.entries);
      expect(clientRes.valid).toBe(true);
      expect(clientRes.headHash.toLowerCase()).toBe(entry2Hash.toLowerCase());
      expect(clientRes.headHash.toLowerCase()).toBe(json.anchorStatus.onchainHead.toLowerCase());
    });

    it('S1-F9 (Test 3): Modifying 1 byte causes client head mismatch with on-chain anchor (không khớp)', async () => {
      process.env.PAYMENT_MODE = 'LIVE_FUJI';
      setAnchorFetcherForTesting(async () => entry2Hash);

      const { GET } = await import('../app/api/verify/[missionId]/route');
      const req = new Request('http://localhost/api/verify/fuji-live-mission-s1b');
      const res = await GET(req as any, { params: Promise.resolve({ missionId: 'fuji-live-mission-s1b' }) });
      const json = await res.json();

      // Modify 1 byte in the last entry's canonicalJson and recompute its entryHash
      const lastIdx = json.entries.length - 1;
      const tamperedEntries = json.entries.map((e: any, idx: number) => {
        if (idx === lastIdx) {
          const tamperedJson = e.canonicalJson.replace('"chain_id":"43113"', '"chain_id":"43114"');
          return {
            ...e,
            entryHash: keccak256(stringToBytes(tamperedJson)),
            canonicalJson: tamperedJson,
          };
        }
        return e;
      });

      const tamperedClientRes = verifyProof(tamperedEntries);
      const isMatch = tamperedClientRes.valid && tamperedClientRes.headHash.toLowerCase() === json.anchorStatus.onchainHead.toLowerCase();
      expect(isMatch).toBe(false);
      expect(tamperedClientRes.headHash.toLowerCase()).not.toBe(json.anchorStatus.onchainHead.toLowerCase());
    });
  });
});
