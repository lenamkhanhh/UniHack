import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { backfillMissionAuditProjections, canonicalAuditJson, computeEntryHash, INITIAL_PREV_HASH } from '../apps/web/lib/audit';

async function main() {
  const db = new PGlite();
  try {
    const initSql = fs.readFileSync(path.resolve(__dirname, '../apps/web/prisma/migrations/20261104000000_init/migration.sql'), 'utf8');
    const round2Sql = fs.readFileSync(path.resolve(__dirname, '../apps/web/prisma/migrations/20261104100000_round2_hardening/migration.sql'), 'utf8');

    await db.exec(initSql);
    await db.exec(round2Sql);

    const slug = 'legacy-a';
    await db.query(
      'INSERT INTO "Mission" ("slug","missionId","ownerAddress","agentAddress","treasuryCap","toolCap","spentTool","reservedTool","expiresAt","status","policyHash","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP)',
      [slug, 'm-1', '0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', 10000000, 5000000, 0, 0, new Date('2026-11-06'), 'ACTIVE', '0x0']
    );

    const c1 = canonicalAuditJson({
      actor: '0x1111111111111111111111111111111111111111', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:00:00.000Z',
      kind: 'TOOL_RESERVED', mission_id: slug, operation_id: 'op-1', policy_hash: '0x0', policy_version: '1', prev_hash: INITIAL_PREV_HASH,
      reason: 'leg1', result_hash: '', rule: '', source_key: 'entry:leg1', to: '', tx_hash: ''
    });
    const h1 = computeEntryHash(c1);

    const c2 = canonicalAuditJson({
      actor: '0x1111111111111111111111111111111111111111', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:01:00.000Z',
      kind: 'TOOL_PAID', mission_id: slug, operation_id: 'op-2', policy_hash: '0x0', policy_version: '1', prev_hash: h1,
      reason: 'proj2', result_hash: '', rule: '', source_key: 'entry:proj2', to: '', tx_hash: ''
    });
    const h2 = computeEntryHash(c2);

    await db.query(
      'INSERT INTO "AuditEntry" ("sourceKey","canonicalJson","entryHash","prevHash","missionSlug","missionSequence","missionPrevHash","missionEntryHash","missionCanonicalJson","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)',
      ['entry:leg1', c1, h1, INITIAL_PREV_HASH, slug, null, null, null, null]
    );

    await db.query(
      'INSERT INTO "AuditEntry" ("sourceKey","canonicalJson","entryHash","prevHash","missionSlug","missionSequence","missionPrevHash","missionEntryHash","missionCanonicalJson","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)',
      ['entry:proj2', c2, h2, h1, slug, 1, INITIAL_PREV_HASH, h2, c2]
    );

    const tx = {
      mission: {
        findMany: async ({ where }: any) => {
          const res = where?.slug
            ? await db.query('SELECT * FROM "Mission" WHERE "slug" = $1', [where.slug])
            : await db.query('SELECT * FROM "Mission"');
          return res.rows.map((r: any) => ({ ...r, auditEntryCount: Number(r.auditEntryCount) }));
        },
        update: async ({ where, data }: any) => {
          await db.query('UPDATE "Mission" SET "auditHeadHash" = $1, "auditEntryCount" = $2 WHERE "slug" = $3', [data.auditHeadHash, data.auditEntryCount, where.slug]);
        }
      },
      auditEntry: {
        findMany: async ({ where }: any) => {
          const targetSlug = where?.missionSlug || where?.OR?.[0]?.missionSlug || slug;
          const res = await db.query('SELECT * FROM "AuditEntry" WHERE "missionSlug" = $1 OR "canonicalJson" LIKE $2 ORDER BY id ASC', [targetSlug, `%"mission_id":"${targetSlug}"%`]);
          return res.rows.map((r: any) => ({ ...r, id: BigInt(r.id), missionSequence: r.missionSequence !== null ? Number(r.missionSequence) : null }));
        },
        update: async ({ where, data }: any) => {
          await db.query(
            'UPDATE "AuditEntry" SET "missionSequence" = $1, "missionPrevHash" = $2, "missionEntryHash" = $3, "missionCanonicalJson" = $4 WHERE id = $5',
            [data.missionSequence, data.missionPrevHash ?? null, data.missionEntryHash ?? null, data.missionCanonicalJson ?? null, Number(where.id)]
          );
        }
      }
    };

    const res = await backfillMissionAuditProjections(tx as any, slug);

    // Oracle Assertions
    if (res.projectedCount !== 2) {
      throw new Error(`Oracle failure: projectedCount expected 2, got ${res.projectedCount}`);
    }
    if (!res.missionsUpdated.includes(slug)) {
      throw new Error(`Oracle failure: missionsUpdated did not include '${slug}'`);
    }

    const entriesCheck = await db.query(
      'SELECT id, "missionSequence", "missionPrevHash", "missionEntryHash" FROM "AuditEntry" WHERE "missionSlug" = $1 ORDER BY id ASC',
      [slug]
    );
    if (entriesCheck.rows.length !== 2) {
      throw new Error(`Oracle failure: expected 2 entries in DB, found ${entriesCheck.rows.length}`);
    }
    if (entriesCheck.rows[0].missionSequence !== 1 || entriesCheck.rows[0].missionPrevHash !== INITIAL_PREV_HASH) {
      throw new Error('Oracle failure: Entry 0 sequence or prevHash mismatch');
    }
    if (entriesCheck.rows[1].missionSequence !== 2 || entriesCheck.rows[1].missionPrevHash !== entriesCheck.rows[0].missionEntryHash) {
      throw new Error('Oracle failure: Entry 1 sequence or continuous hash link mismatch');
    }

    const missionCheck = await db.query('SELECT "auditHeadHash", "auditEntryCount" FROM "Mission" WHERE "slug" = $1', [slug]);
    if (Number(missionCheck.rows[0].auditEntryCount) !== 2) {
      throw new Error(`Oracle failure: Mission auditEntryCount expected 2, got ${missionCheck.rows[0].auditEntryCount}`);
    }
    if (missionCheck.rows[0].auditHeadHash !== entriesCheck.rows[1].missionEntryHash) {
      throw new Error('Oracle failure: Mission auditHeadHash does not match final entry missionEntryHash');
    }

    console.log(`MIXED_BACKFILL_PASS ${JSON.stringify(res)}`);
  } finally {
    await db.close();
  }
}

main().catch(err => {
  console.error('PROBE_FAILED:', err);
  process.exit(1);
});
