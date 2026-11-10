import { processQueuedValidationJobs } from '../lib/validator-job';

async function main() {
  console.log('[Validator Worker] Starting process-once validation runner...');
  const limit = parseInt(process.env.VALIDATOR_WORKER_LIMIT || '10', 10);
  const result = await processQueuedValidationJobs(limit);
  console.log(`[Validator Worker] Finished processing ${result.processed} job(s).`);
  for (const res of result.results) {
    console.log(`  - Mission: ${res.bundle?.missionSlug || 'unknown'}, status: ${res.status}, score: ${res.validationResult?.score ?? 'N/A'}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[Validator Worker] Fatal error:', err);
  process.exit(1);
});
