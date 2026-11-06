import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:55432/unihack_test';

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const adapter = new PrismaPg(pool);

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export { pool };

/**
 * Strict lock ordering according to 02 §5, 05 §2:
 * mission → session → operation → audit head
 */
export async function withLockOrder<T>(
  fn: (tx: any) => Promise<T>,
  locks: {
    missionSlug?: string;
    sessionId?: string;
    operationId?: string;
    lockAuditHead?: boolean;
  }
): Promise<T> {
  const maxRetries = 3;
  let attempt = 0;

  while (true) {
    try {
      return await prisma.$transaction(async (tx) => {
        // 1. Lock Mission
        if (locks.missionSlug) {
          await tx.$queryRaw`SELECT 1 FROM "Mission" WHERE "slug" = ${locks.missionSlug} FOR UPDATE`;
        }
        // 2. Lock Session (if applicable)
        if (locks.sessionId) {
          await tx.$queryRaw`SELECT 1 FROM "ToolSession" WHERE "id" = ${locks.sessionId}::uuid FOR UPDATE`;
        }
        // 3. Lock Operation (if applicable)
        if (locks.operationId) {
          await tx.$queryRaw`SELECT 1 FROM "ToolOperation" WHERE "operationId" = ${locks.operationId}::uuid FOR UPDATE`;
        }
        // 4. Lock AuditHead (if applicable)
        if (locks.lockAuditHead) {
          await tx.$queryRaw`SELECT 1 FROM "AuditHead" WHERE "id" = 1 FOR UPDATE`;
        }

        return await fn(tx);
      });
    } catch (err: any) {
      attempt++;
      // Deadlock / serialization failure retry
      if (
        attempt < maxRetries &&
        (err?.code === 'P2034' || err?.message?.includes('deadlock') || err?.code === '40P01')
      ) {
        await new Promise((res) => setTimeout(res, 50 * attempt));
        continue;
      }
      throw err;
    }
  }
}
