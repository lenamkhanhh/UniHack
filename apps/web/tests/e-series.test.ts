import { describe, it, expect, beforeEach } from 'vitest';
import { prisma, withLockOrder } from '@/lib/db';
import { clearDatabase } from './setup';
import {
  appendAuditEntry,
  canonicalAuditJson,
  computeEntryHash,
  verifyAuditChain,
  INITIAL_PREV_HASH,
} from '@/lib/audit';

describe('Evidence & Audit E-series Integration Tests (06 §4)', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  // E1: Audit concurrent append serialized; unique source keys; duplicate terminal/event ingest không duplicate
  it('E1: Audit append enforces row-level serialization and duplicate sourceKeys do not duplicate entries', async () => {
    // Append 5 entries in parallel
    const parallelAppends = Array.from({ length: 5 }).map((_, i) =>
      withLockOrder(
        async (tx) => {
          return await appendAuditEntry(tx, {
            actor: '0x1111111111111111111111111111111111111111',
            amount: '100000',
            chain_id: '43113',
            kind: 'TOOL_RESERVED',
            mission_id: 'test-mission',
            operation_id: `op-e1-${i}`,
            policy_hash: '0x0',
            policy_version: '1',
            reason: `Parallel append ${i}`,
            result_hash: '',
            rule: 'RESERVE',
            source_key: `event:tx1:${i}`,
            to: '0x2222222222222222222222222222222222222222',
            tx_hash: '0xtx1',
          });
        },
        { lockAuditHead: true }
      )
    );

    await Promise.all(parallelAppends);

    const entries = await prisma.auditEntry.findMany({ orderBy: { id: 'asc' } });
    expect(entries.length).toBe(5);

    // Verify hash chain continuity: entry[i].prevHash === entry[i-1].entryHash
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].prevHash.toLowerCase()).toBe(entries[i - 1].entryHash.toLowerCase());
    }

    // Duplicate sourceKey attempt is idempotent and does not create 6th entry
    await withLockOrder(
      async (tx) => {
        return await appendAuditEntry(tx, {
          actor: '0x1111111111111111111111111111111111111111',
          amount: '100000',
          chain_id: '43113',
          kind: 'TOOL_RESERVED',
          mission_id: 'test-mission',
          operation_id: 'op-e1-0',
          policy_hash: '0x0',
          policy_version: '1',
          reason: 'Duplicate append attempt',
          result_hash: '',
          rule: 'RESERVE',
          source_key: 'event:tx1:0', // same sourceKey as first entry
          to: '0x2222222222222222222222222222222222222222',
          tx_hash: '0xtx1',
        });
      },
      { lockAuditHead: true }
    );

    const entriesAfterDuplicate = await prisma.auditEntry.findMany({});
    expect(entriesAfterDuplicate.length).toBe(5); // Still 5
  });

  // E2: Export canonical verifier pass với original; tamper/reorder/truncate lệch checkpoint fail
  it('E2: Canonical audit verifier succeeds on original chain and detects tampering, reordering, and truncation', async () => {
    // Populate clean 3-entry chain
    for (let i = 0; i < 3; i++) {
      await withLockOrder(
        async (tx) => {
          return await appendAuditEntry(tx, {
            actor: '0x1111111111111111111111111111111111111111',
            amount: '500000',
            chain_id: '43113',
            kind: 'TOOL_PAID',
            mission_id: 'test-mission',
            operation_id: `op-e2-${i}`,
            policy_hash: '0x0',
            policy_version: '1',
            reason: `Step ${i}`,
            result_hash: '0xresult',
            rule: 'SETTLE',
            source_key: `e2:key:${i}`,
            to: '0x2222222222222222222222222222222222222222',
            tx_hash: `0xtx_${i}`,
          });
        },
        { lockAuditHead: true }
      );
    }

    const entries = await prisma.auditEntry.findMany({ orderBy: { id: 'asc' } });
    const head = await prisma.auditHead.findUnique({ where: { id: 1 } });

    // 1. Original chain passes
    const validResult = verifyAuditChain(entries, head?.lastHash);
    expect(validResult.valid).toBe(true);
    expect(validResult.totalEntries).toBe(3);

    // 2. Tampered entry content fails hash check
    const tamperedEntries = entries.map((e) => ({
      sourceKey: e.sourceKey,
      prevHash: e.prevHash,
      entryHash: e.entryHash,
      canonicalJson: e.canonicalJson,
    }));
    tamperedEntries[1].canonicalJson = tamperedEntries[1].canonicalJson.replace('500000', '999999');
    const tamperedResult = verifyAuditChain(tamperedEntries, head?.lastHash);
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.errors.some((e: string) => e.includes('Hash mismatch'))).toBe(true);

    // 3. Reordered entries fail prevHash linkage
    const reorderedEntries = [entries[0], entries[2], entries[1]];
    const reorderedResult = verifyAuditChain(reorderedEntries, head?.lastHash);
    expect(reorderedResult.valid).toBe(false);
    expect(reorderedResult.errors.some((e: string) => e.includes('Chain break'))).toBe(true);

    // 4. Truncated chain fails checkpoint headHash match
    const truncatedEntries = [entries[0], entries[1]];
    const truncatedResult = verifyAuditChain(truncatedEntries, head?.lastHash);
    expect(truncatedResult.valid).toBe(false);
    expect(truncatedResult.errors.some((e: string) => e.includes('Head hash mismatch'))).toBe(true);
  });
});
