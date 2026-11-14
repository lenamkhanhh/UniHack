import { describe, it, expect } from 'vitest';
import { canonicalAuditJson, computeEntryHash, INITIAL_PREV_HASH, AuditEntryFields } from '@/lib/audit';
import {
  buildMissionAuditExport,
  assertExportValid,
  recomputeMissionChain,
  seedMissionAudit,
  SeedClient,
  MissionAuditExport,
} from '../../../scripts/lib/mission-audit';

const SLUG = 'fixture-mission-audit';
const OWNER = '0x4bc93356c180ba2dd13a4a1cf43405bd0eb58f7c';

/** Builds rows the way appendAuditEntry does: a global chain plus the mission-scoped projection. */
function buildFixture(count = 4) {
  let globalPrev = '0x1111111111111111111111111111111111111111111111111111111111111111'; // pre-existing global head
  let missionPrev = INITIAL_PREV_HASH;
  const rows: any[] = [];
  const kinds: AuditEntryFields['kind'][] = ['SESSION_WALLET_FUNDED', 'PAYEE_ROOT_SET', 'TOOL_RESERVED', 'PROPOSED'];
  for (let i = 0; i < count; i++) {
    const createdAt = new Date(Date.UTC(2026, 10, 13, 0, 0, i)).toISOString();
    const base: Omit<AuditEntryFields, 'prev_hash'> = {
      actor: OWNER, amount: String(1000 * (i + 1)), chain_id: '43113', created_at: createdAt,
      kind: kinds[i % kinds.length], mission_id: SLUG, operation_id: `op-${i}`, policy_hash: '0xabc',
      policy_version: '1', reason: `entry ${i}`, result_hash: '', rule: 'RULE', source_key: `src:${SLUG}:${i}`,
      to: OWNER, tx_hash: `0x${String(i).padStart(64, '0')}`,
    };
    const canonicalJson = canonicalAuditJson({ ...base, prev_hash: globalPrev });
    const entryHash = computeEntryHash(canonicalJson);
    const missionCanonicalJson = canonicalAuditJson({ ...base, prev_hash: missionPrev });
    const missionEntryHash = computeEntryHash(missionCanonicalJson);
    rows.push({
      id: BigInt(i + 1), sourceKey: base.source_key, prevHash: globalPrev, entryHash, canonicalJson,
      missionSlug: SLUG, missionSequence: i + 1, missionPrevHash: missionPrev, missionEntryHash, missionCanonicalJson,
      createdAt: new Date(createdAt),
    });
    globalPrev = entryHash;
    missionPrev = missionEntryHash;
  }
  const mission = {
    slug: SLUG, missionId: '0x' + 'ab'.repeat(32), ownerAddress: OWNER, agentAddress: OWNER,
    treasuryCap: { toFixed: () => '100000', toString: () => '100000' }, // Prisma Decimal-like
    toolCap: '20000', spentTool: '0', reservedTool: '0', expiresAt: new Date('2026-11-20T00:00:00Z'),
    status: 'CLOSED', completedAt: null, deliverableHash: '0x' + 'cd'.repeat(32), payeesJson: JSON.stringify([OWNER]),
    payeeRoot: '0x' + 'ef'.repeat(32), creationBlock: 123n, creationTxHash: '0x' + '01'.repeat(32),
    creationProvenance: 'RECEIPT_EVENT_VERIFIED', configVersion: 1, policyHash: '0xabc', auditHeadHash: missionPrev,
    auditEntryCount: count, publicPublished: true, publicationVersion: 0,
    createdAt: new Date('2026-11-13T00:00:00Z'), updatedAt: new Date('2026-11-13T00:00:10Z'),
  };
  const job = {
    id: 'job-1', missionSlug: SLUG, missionId: mission.missionId, requestHash: '0x' + '99'.repeat(32),
    status: 'RESPONSE_CONFIRMED', mode: 'LIVE_FUJI', fromBlock: 123n, toBlock: 130n, snapshotBlock: 130n,
    score: 100, chainScore: 100, tag: 'verified-full', chainTag: 'verified-full', workerLeaseOwner: 'w', leaseToken: 't',
    workerLeaseUntil: new Date(), createdAt: new Date('2026-11-13T00:00:00Z'), updatedAt: new Date('2026-11-13T00:00:00Z'),
  };
  return { rows, mission, job };
}

/** In-memory stand-in for the Prisma methods seedMissionAudit uses. */
function memoryClient() {
  const missions = new Map<string, any>();
  const entries: any[] = [];
  const jobs = new Map<string, any>();
  const stats = { createMany: 0 };
  const client: SeedClient & { _entries: any[]; _missions: Map<string, any>; _jobs: Map<string, any>; stats: typeof stats } = {
    _entries: entries, _missions: missions, _jobs: jobs, stats,
    async $transaction(fn: any) { return fn(client); },
    mission: {
      async upsert({ where, create, update }: any) {
        const cur = missions.get(where.slug);
        const next = cur ? { ...cur, ...update } : { ...create };
        missions.set(where.slug, next);
        return next;
      },
      async findUnique({ where }: any) { return missions.get(where.slug) ?? null; },
    },
    auditEntry: {
      async count({ where }: any) { return entries.filter((e) => e.missionSlug === where.missionSlug).length; },
      async createMany({ data }: any) {
        stats.createMany++;
        for (const d of data) {
          if (entries.some((e) => e.sourceKey === d.sourceKey)) throw new Error('unique sourceKey');
          entries.push({ ...d });
        }
        return { count: data.length };
      },
      async findMany({ where }: any) {
        return entries.filter((e) => e.missionSlug === where.missionSlug).sort((a, b) => a.missionSequence - b.missionSequence);
      },
    },
    validationJob: {
      async upsert({ where, create, update }: any) {
        const cur = jobs.get(where.missionSlug);
        const next = cur ? { ...cur, ...update } : { ...create };
        jobs.set(where.missionSlug, next);
        return next;
      },
    },
  };
  return client;
}

function exportFixture(): MissionAuditExport {
  const { rows, mission, job } = buildFixture();
  // Round-trip through JSON like the real audit.json file.
  return JSON.parse(JSON.stringify(buildMissionAuditExport(mission, rows, job, '2026-11-13T00:00:00.000Z')));
}

describe('mission audit export: chain recompute', () => {
  it('recomputes the mission chain from missionCanonicalJson and ends at auditHeadHash', () => {
    const doc = exportFixture();
    expect(doc.entries).toHaveLength(4);
    expect(doc.mission.treasuryCap).toBe('100000');
    expect(doc.mission.creationBlock).toBe('123');
    expect(doc.validationJob?.leaseToken).toBeUndefined();
    const res = assertExportValid(doc);
    expect(res.valid).toBe(true);
    expect(res.headHash).toBe(doc.mission.auditHeadHash);
    // Mission chain differs from the global chain (different prev_hash), and only the mission one matches.
    expect(doc.entries[3].entryHash).not.toBe(doc.mission.auditHeadHash);
  });

  it('rejects a tampered canonicalJson, a wrong head, a reordered chain and a dropped entry', () => {
    const tampered = exportFixture();
    tampered.entries[1].missionCanonicalJson = tampered.entries[1].missionCanonicalJson.replace('"amount":"2000"', '"amount":"9000"');
    expect(() => assertExportValid(tampered)).toThrow(/AUDIT_CHAIN_INVALID/);

    const wrongHead = exportFixture();
    wrongHead.mission.auditHeadHash = '0x' + '00'.repeat(31) + '01';
    expect(() => assertExportValid(wrongHead)).toThrow(/Head mismatch/);

    const swapped = exportFixture();
    [swapped.entries[1].missionSequence, swapped.entries[2].missionSequence] = [3, 2];
    expect(recomputeMissionChain(swapped.entries, swapped.mission.auditHeadHash).valid).toBe(false);

    const dropped = exportFixture();
    dropped.entries.pop();
    expect(() => assertExportValid(dropped)).toThrow();
  });
});

describe('mission audit seed: idempotency', () => {
  it('inserts once, re-verifies, and a second run inserts nothing', async () => {
    const doc = exportFixture();
    const client = memoryClient();

    const first = await seedMissionAudit(client, doc);
    expect(first.entriesInserted).toBe(4);
    expect(first.verify.valid).toBe(true);
    expect(first.validationJobUpserted).toBe(true);
    expect(client._missions.get(SLUG).creationBlock).toBe(123n);
    expect(client._missions.get(SLUG).expiresAt).toBeInstanceOf(Date);

    const second = await seedMissionAudit(client, doc);
    expect(second.entriesInserted).toBe(0);
    expect(second.entriesSkippedExisting).toBe(4);
    expect(second.verify.valid).toBe(true);
    expect(client._entries).toHaveLength(4);
    expect(client.stats.createMany).toBe(1);
    expect(client._jobs.size).toBe(1);
  });

  it('refuses to seed an invalid export', async () => {
    const doc = exportFixture();
    doc.entries[0].missionEntryHash = '0x' + '22'.repeat(32);
    const client = memoryClient();
    await expect(seedMissionAudit(client, doc)).rejects.toThrow(/AUDIT_CHAIN_INVALID/);
    expect(client._entries).toHaveLength(0);
  });

  it('fails verification if the target DB already holds a different chain for the slug', async () => {
    const doc = exportFixture();
    const client = memoryClient();
    client._entries.push({ ...doc.entries[0], missionSlug: SLUG, missionSequence: 1, missionEntryHash: '0x' + '33'.repeat(32) });
    await expect(seedMissionAudit(client, doc)).rejects.toThrow(/SEED_VERIFY_FAILED/);
  });
});
