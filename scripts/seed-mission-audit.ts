/**
 * Idempotently seed a mission + its audit entries (+ ValidationJob) from
 * evidence/missions/<slug>/audit.json into the DB pointed to by DATABASE_URL:
 *   - upsert Mission by slug
 *   - insert AuditEntry rows only if the mission has none yet
 *   - re-read and re-verify the mission hash chain after insert
 *
 * Usage: npx tsx scripts/seed-mission-audit.ts --slug <slug> [--in <path>]
 * DB: DATABASE_URL from the environment, else apps/web/.env.
 */

import fs from 'fs';
import path from 'path';
import { loadEnvFile, seedMissionAudit, MissionAuditExport } from './lib/mission-audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg('slug');
  if (!slug) throw new Error('Usage: seed-mission-audit.ts --slug <slug> [--in <path>]');

  const inPath = path.resolve(arg('in') || path.resolve(__dirname, `../evidence/missions/${slug}/audit.json`));
  const doc: MissionAuditExport = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  if (doc.slug !== slug) throw new Error(`Export slug ${doc.slug} != --slug ${slug}`);

  loadEnvFile(fs, path.resolve(__dirname, '../apps/web/.env'));
  const { prisma } = await import('../apps/web/lib/db');

  try {
    const dbName = (() => {
      try { return new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, ''); } catch { return '?'; }
    })();
    console.log(`[seed] DB: ${dbName} | slug: ${slug} | source: ${inPath}`);

    const res = await seedMissionAudit(prisma as any, doc);
    console.log(
      `[seed] mission upserted; entries inserted=${res.entriesInserted}, already present=${res.entriesSkippedExisting}; ` +
        `validationJob=${res.validationJobUpserted ? 'upserted' : 'none'}`
    );
    console.log(`[seed] Chain VALID after seed: ${res.verify.entryCount} entries, head ${res.verify.headHash}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err.message || err);
  process.exit(1);
});
