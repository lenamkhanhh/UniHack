import path from 'path';
import fs from 'fs';

// 1. Load project environment files in order (.env.local, .env) BEFORE importing db or config
const webDir = path.resolve(__dirname, '..');
const envLocal = path.join(webDir, '.env.local');
const envMain = path.join(webDir, '.env');

function loadEnvFileSafe(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  try {
    if (typeof (process as any).loadEnvFile === 'function') {
      (process as any).loadEnvFile(filePath);
      return;
    }
  } catch {
    // fallback to manual parse if process.loadEnvFile throws or unsupported
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore
  }
}

loadEnvFileSafe(envLocal);
loadEnvFileSafe(envMain);

async function main() {
  console.log('[Validator Worker] Starting process-once validation runner...');

  // 2. Validate bounded limit (1..100, default 10)
  const rawLimit = parseInt(
    process.env.WORKER_LIMIT || process.env.VALIDATOR_WORKER_LIMIT || '10',
    10
  );
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10;

  // 3. Dynamic import of modules after environment is loaded
  const { processQueuedValidationJobs } = await import('../lib/validator-job');
  const { prisma } = await import('../lib/db');

  let hasFailures = false;
  try {
    const result = await processQueuedValidationJobs(limit);
    console.log(`[Validator Worker] Finished processing ${result.processed} job(s).`);

    for (const res of result.results) {
      const slug = res.bundle?.missionSlug || 'unknown';
      const score = res.validationResult?.score ?? res.chainScore ?? 'N/A';
      console.log(`  - Mission: ${slug}, status: ${res.status}, score: ${score}`);
      if (res.status === 'FAILED' || res.status === 'STALE_CONTEXT') {
        hasFailures = true;
      }
    }
  } finally {
    // 4. Close database connection cleanly
    await prisma.$disconnect();
  }

  // 5. Report nonzero when processing failures occur
  process.exit(hasFailures ? 1 : 0);
}

main().catch((err) => {
  console.error('[Validator Worker] Fatal error:', err?.message || err);
  process.exit(1);
});
