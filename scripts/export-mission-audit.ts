/**
 * Export a mission row + its mission-scoped audit entries (+ ValidationJob if any) to
 * evidence/missions/<slug>/audit.json, after recomputing the hash chain from
 * missionCanonicalJson and asserting it ends at mission.auditHeadHash.
 *
 * Usage: npx tsx scripts/export-mission-audit.ts --slug <slug> [--out <path>]
 * DB: DATABASE_URL from the environment, else apps/web/.env.
 */

import fs from 'fs';
import path from 'path';
import { loadEnvFile, buildMissionAuditExport, assertExportValid } from './lib/mission-audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg('slug');
  if (!slug) throw new Error('Usage: export-mission-audit.ts --slug <slug> [--out <path>]');

  loadEnvFile(fs, path.resolve(__dirname, '../apps/web/.env'));
  const { prisma } = await import('../apps/web/lib/db');

  try {
    const dbName = (() => {
      try { return new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, ''); } catch { return '?'; }
    })();
    console.log(`[export] DB: ${dbName} | slug: ${slug}`);

    const mission = await prisma.mission.findUnique({ where: { slug } });
    if (!mission) throw new Error(`Mission ${slug} not found`);
    const rows = await prisma.auditEntry.findMany({ where: { missionSlug: slug }, orderBy: { missionSequence: 'asc' } });
    const job = await prisma.validationJob.findUnique({ where: { missionSlug: slug } }).catch(() => null);

    const doc = buildMissionAuditExport(mission as any, rows as any[], job as any);
    const check = assertExportValid(doc);

    const outPath = path.resolve(arg('out') || path.resolve(__dirname, `../evidence/missions/${slug}/audit.json`));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');

    console.log(`[export] Chain VALID: ${check.entryCount} entries, head ${check.headHash}`);
    console.log(`[export] ValidationJob: ${doc.validationJob ? doc.validationJob.status : 'none'}`);
    console.log(`[export] Wrote ${outPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[export] FAILED:', err.message || err);
  process.exit(1);
});
