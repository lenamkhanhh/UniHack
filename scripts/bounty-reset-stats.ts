/**
 * Script: bounty-reset-stats.ts
 *
 * Prunes non-public test/smoke attempts from BountyAttempt table.
 * Preserves all public attempts submitted by judges / reviewers.
 */

import path from 'path';
import { PrismaClient } from '@prisma/client';

// Load environment variables for DB connection
try {
  process.loadEnvFile(path.resolve(__dirname, '../apps/web/.env'));
} catch {}

const prisma = new PrismaClient();

async function main() {
  console.log('[Bounty Prune] Pruning test records from bounty_attempts...');

  const deleted = await prisma.bountyAttempt.deleteMany({
    where: {
      OR: [
        { source: 'test' },
        { mode: 'stub' },
        { model: { contains: 'fallback' } },
        { model: { contains: 'benign-default' } },
        { model: { contains: 'stub' } },
      ],
    },
  });

  console.log(`[Bounty Prune] Pruned ${deleted.count} test/stub attempts.`);

  const remaining = await prisma.bountyAttempt.count({
    where: {
      mode: 'llm',
      source: 'public',
    },
  });

  console.log(`[Bounty Prune] Remaining public attempts: ${remaining}`);
}

main()
  .catch((err) => {
    console.error('[Bounty Prune Error]', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
