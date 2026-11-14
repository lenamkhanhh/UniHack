/**
 * Shared, DB-agnostic helpers for exporting / seeding a mission's audit chain.
 *
 * The mission-scoped chain is the one /verify/<slug> checks and the one anchored on-chain
 * (mission.auditHeadHash): each entry stores missionPrevHash / missionEntryHash /
 * missionCanonicalJson next to the global prevHash / entryHash / canonicalJson.
 * Recompute rules mirror apps/web/lib/audit.ts (canonicalAuditJson + computeEntryHash)
 * and apps/web/lib/proof-verifier.ts (verifyProof).
 */

import { canonicalAuditJson, computeEntryHash, INITIAL_PREV_HASH } from '../../apps/web/lib/audit';
import { verifyProof } from '../../apps/web/lib/proof-verifier';

export const AUDIT_EXPORT_VERSION = 'MissionPay-audit-export-v1';

export interface ExportedAuditEntry {
  missionSequence: number;
  sourceKey: string;
  prevHash: string;
  entryHash: string;
  canonicalJson: string;
  missionPrevHash: string;
  missionEntryHash: string;
  missionCanonicalJson: string;
  createdAt: string;
}

export interface MissionAuditExport {
  version: string;
  exportedAt: string;
  slug: string;
  mission: Record<string, any>;
  validationJob: Record<string, any> | null;
  entries: ExportedAuditEntry[];
  chain: { entryCount: number; headHash: string };
}

export interface ChainCheckResult {
  valid: boolean;
  headHash: string;
  entryCount: number;
  errors: string[];
}

/** JSON-safe copy of a Prisma row: BigInt/Decimal -> string, Date -> ISO string. */
export function toPlainRow(row: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = v ?? null;
    else if (typeof v === 'bigint') out[k] = v.toString();
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'object' && typeof (v as any).toFixed === 'function') out[k] = v.toString(); // Prisma Decimal
    else out[k] = v;
  }
  return out;
}

/**
 * Recomputes the mission-scoped hash chain from missionCanonicalJson and checks it ends at expectedHead.
 * Also checks the global entryHash = keccak(canonicalJson) and that both JSON blobs are canonical.
 */
export function recomputeMissionChain(
  entries: Array<Pick<ExportedAuditEntry, 'missionSequence' | 'sourceKey' | 'entryHash' | 'canonicalJson' | 'missionPrevHash' | 'missionEntryHash' | 'missionCanonicalJson'>>,
  expectedHead: string,
  expectedCount?: number
): ChainCheckResult {
  const errors: string[] = [];
  const sorted = [...entries].sort((a, b) => a.missionSequence - b.missionSequence);
  let prev = INITIAL_PREV_HASH;

  sorted.forEach((e, i) => {
    if (e.missionSequence !== i + 1) {
      errors.push(`Sequence gap at index ${i}: expected ${i + 1}, got ${e.missionSequence}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(e.missionCanonicalJson);
    } catch (err: any) {
      errors.push(`Invalid missionCanonicalJson at seq ${e.missionSequence}: ${err.message}`);
      return;
    }
    if (canonicalAuditJson(parsed) !== e.missionCanonicalJson) {
      errors.push(`missionCanonicalJson at seq ${e.missionSequence} is not canonical`);
    }
    if ((parsed.prev_hash || '').toLowerCase() !== prev.toLowerCase()) {
      errors.push(`Chain break at seq ${e.missionSequence}: prev_hash ${parsed.prev_hash} != ${prev}`);
    }
    if ((e.missionPrevHash || '').toLowerCase() !== prev.toLowerCase()) {
      errors.push(`missionPrevHash mismatch at seq ${e.missionSequence}`);
    }
    const computed = computeEntryHash(e.missionCanonicalJson);
    if (computed.toLowerCase() !== (e.missionEntryHash || '').toLowerCase()) {
      errors.push(`missionEntryHash mismatch at seq ${e.missionSequence}: computed ${computed}`);
    }
    if (parsed.source_key !== e.sourceKey) {
      errors.push(`source_key mismatch at seq ${e.missionSequence}`);
    }
    if (computeEntryHash(e.canonicalJson).toLowerCase() !== (e.entryHash || '').toLowerCase()) {
      errors.push(`Global entryHash mismatch at seq ${e.missionSequence}`);
    }
    prev = computed;
  });

  // Same check the browser/CLI verifier runs on /verify/<slug>.
  const proof = verifyProof(
    sorted.map((e) => ({
      sourceKey: e.sourceKey,
      prevHash: e.missionPrevHash,
      entryHash: e.missionEntryHash,
      canonicalJson: e.missionCanonicalJson,
    })),
    { headHash: expectedHead, entryCount: expectedCount ?? sorted.length }
  );
  errors.push(...proof.errors.map((m) => `verifyProof: ${m}`));

  if (sorted.length === 0) errors.push('No audit entries');
  if (prev.toLowerCase() !== (expectedHead || '').toLowerCase()) {
    errors.push(`Head mismatch: recomputed ${prev} != expected ${expectedHead}`);
  }

  return { valid: errors.length === 0, headHash: prev, entryCount: sorted.length, errors };
}

/** Builds the export document from DB rows (mission row, mission-scoped entries, optional ValidationJob). */
export function buildMissionAuditExport(
  mission: Record<string, any>,
  rows: Array<Record<string, any>>,
  validationJob: Record<string, any> | null,
  exportedAt = new Date().toISOString()
): MissionAuditExport {
  const entries: ExportedAuditEntry[] = rows
    .map((r) => ({
      missionSequence: Number(r.missionSequence),
      sourceKey: r.sourceKey,
      prevHash: r.prevHash,
      entryHash: r.entryHash,
      canonicalJson: r.canonicalJson,
      missionPrevHash: r.missionPrevHash,
      missionEntryHash: r.missionEntryHash,
      missionCanonicalJson: r.missionCanonicalJson,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }))
    .sort((a, b) => a.missionSequence - b.missionSequence);

  const plainMission = toPlainRow(mission)!;
  const plainJob = toPlainRow(validationJob);
  if (plainJob) {
    // Lease/fencing fields are worker-local state, not evidence.
    delete plainJob.workerLeaseUntil;
    delete plainJob.workerLeaseOwner;
    delete plainJob.leaseToken;
  }

  return {
    version: AUDIT_EXPORT_VERSION,
    exportedAt,
    slug: plainMission.slug,
    mission: plainMission,
    validationJob: plainJob,
    entries,
    chain: { entryCount: entries.length, headHash: plainMission.auditHeadHash },
  };
}

/** Asserts the export is internally consistent; throws with all errors otherwise. */
export function assertExportValid(doc: MissionAuditExport): ChainCheckResult {
  const res = recomputeMissionChain(doc.entries, doc.mission.auditHeadHash, Number(doc.mission.auditEntryCount));
  if (Number(doc.mission.auditEntryCount) !== doc.entries.length) {
    res.errors.push(`mission.auditEntryCount ${doc.mission.auditEntryCount} != entries ${doc.entries.length}`);
    res.valid = false;
  }
  if (!res.valid) {
    throw new Error(`AUDIT_CHAIN_INVALID for ${doc.slug}:\n  - ${res.errors.join('\n  - ')}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Seeding (works with PrismaClient or any object exposing the same methods)
// ---------------------------------------------------------------------------

export interface SeedClient {
  $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  mission: { upsert(args: any): Promise<any>; findUnique(args: any): Promise<any> };
  auditEntry: { count(args: any): Promise<number>; createMany(args: any): Promise<any>; findMany(args: any): Promise<any[]> };
  validationJob?: { upsert(args: any): Promise<any> };
}

const MISSION_BIGINT_FIELDS = new Set(['creationBlock']);
const MISSION_DATE_FIELDS = new Set(['expiresAt', 'completedAt', 'createdAt', 'updatedAt']);
const JOB_BIGINT_FIELDS = new Set(['fromBlock', 'toBlock', 'snapshotBlock']);
const JOB_DATE_FIELDS = new Set(['createdAt', 'updatedAt']);

function reviveRow(row: Record<string, any>, bigints: Set<string>, dates: Set<string>, drop: string[] = []) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (drop.includes(k)) continue;
    if (v === null || v === undefined) out[k] = null;
    else if (bigints.has(k)) out[k] = BigInt(v);
    else if (dates.has(k)) out[k] = new Date(v);
    else out[k] = v;
  }
  return out;
}

export interface SeedResult {
  slug: string;
  missionUpserted: boolean;
  entriesInserted: number;
  entriesSkippedExisting: number;
  validationJobUpserted: boolean;
  verify: ChainCheckResult;
}

/**
 * Idempotent seed: upsert mission by slug, insert entries only if the mission has none,
 * upsert the ValidationJob (if exported), then re-read and re-verify the chain from the DB.
 */
export async function seedMissionAudit(client: SeedClient, doc: MissionAuditExport): Promise<SeedResult> {
  assertExportValid(doc);
  const slug = doc.slug;
  const missionData = reviveRow(doc.mission, MISSION_BIGINT_FIELDS, MISSION_DATE_FIELDS, ['updatedAt']);
  const { slug: _slug, ...missionUpdate } = missionData;

  let inserted = 0;
  let skipped = 0;
  let jobUpserted = false;

  await client.$transaction(async (tx: any) => {
    await tx.mission.upsert({ where: { slug }, create: missionData, update: missionUpdate });

    const existing = await tx.auditEntry.count({ where: { missionSlug: slug } });
    if (existing === 0) {
      await tx.auditEntry.createMany({
        data: doc.entries.map((e) => ({
          sourceKey: e.sourceKey,
          prevHash: e.prevHash,
          entryHash: e.entryHash,
          canonicalJson: e.canonicalJson,
          missionSlug: slug,
          missionSequence: e.missionSequence,
          missionPrevHash: e.missionPrevHash,
          missionEntryHash: e.missionEntryHash,
          missionCanonicalJson: e.missionCanonicalJson,
          createdAt: new Date(e.createdAt),
        })),
      });
      inserted = doc.entries.length;
    } else {
      skipped = existing;
    }

    if (doc.validationJob && tx.validationJob) {
      const jobData = reviveRow(doc.validationJob, JOB_BIGINT_FIELDS, JOB_DATE_FIELDS, ['id', 'updatedAt']);
      const { missionSlug: _m, ...jobUpdate } = jobData;
      await tx.validationJob.upsert({
        where: { missionSlug: slug },
        create: { ...jobData, missionSlug: slug },
        update: jobUpdate,
      });
      jobUpserted = true;
    }
  });

  const mission = await client.mission.findUnique({ where: { slug } });
  const rows = await client.auditEntry.findMany({ where: { missionSlug: slug }, orderBy: { missionSequence: 'asc' } });
  const verify = recomputeMissionChain(
    rows.map((r: any) => ({ ...r, missionSequence: Number(r.missionSequence) })),
    mission?.auditHeadHash,
    Number(mission?.auditEntryCount)
  );
  if (!verify.valid) {
    throw new Error(`SEED_VERIFY_FAILED for ${slug}:\n  - ${verify.errors.join('\n  - ')}`);
  }

  return {
    slug,
    missionUpserted: true,
    entriesInserted: inserted,
    entriesSkippedExisting: skipped,
    validationJobUpserted: jobUpserted,
    verify,
  };
}

/** Minimal .env loader (no override of already-set vars, never prints values). */
export function loadEnvFile(fs: typeof import('fs'), envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const idx = t.indexOf('=');
    const key = t.slice(0, idx).trim();
    let val = t.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
