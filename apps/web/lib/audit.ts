import { keccak256, stringToBytes } from 'viem';
import { normalizeAddress } from './chain';

export interface AuditEntryFields {
  actor: string;
  amount: string;
  chain_id: string;
  created_at: string;
  kind:
    | 'PROPOSED'
    | 'QUEUED'
    | 'APPROVED'
    | 'EXECUTED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'BLOCKED'
    | 'TOOL_RESERVED'
    | 'TOOL_SIGNED'
    | 'TOOL_PAID'
    | 'TOOL_FAILED'
    | 'TOOL_UNKNOWN'
    | 'PAUSED'
    | 'UNPAUSED'
    | 'CUTOVER';
  mission_id: string;
  operation_id: string;
  policy_hash: string;
  policy_version: string;
  prev_hash: string;
  reason: string;
  result_hash: string;
  rule: string;
  source_key: string;
  to: string;
  tx_hash: string;
}

export const INITIAL_PREV_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

export function canonicalAuditJson(fields: AuditEntryFields): string {
  // Sorted lexicographically:
  // actor, amount, chain_id, created_at, kind, mission_id, operation_id, policy_hash,
  // policy_version, prev_hash, reason, result_hash, rule, source_key, to, tx_hash
  const obj: Record<string, string> = {
    actor: normalizeAddress(fields.actor || ''),
    amount: fields.amount || '0',
    chain_id: fields.chain_id || '',
    created_at: fields.created_at || '',
    kind: fields.kind || '',
    mission_id: fields.mission_id || '',
    operation_id: fields.operation_id || '',
    policy_hash: (fields.policy_hash || '').toLowerCase(),
    policy_version: fields.policy_version || '1',
    prev_hash: (fields.prev_hash || '').toLowerCase(),
    reason: fields.reason || '',
    result_hash: (fields.result_hash || '').toLowerCase(),
    rule: fields.rule || '',
    source_key: fields.source_key || '',
    to: normalizeAddress(fields.to || ''),
    tx_hash: (fields.tx_hash || '').toLowerCase(),
  };

  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

export function computeEntryHash(canonicalJson: string): string {
  return keccak256(stringToBytes(canonicalJson));
}

/**
 * Appends an audit entry inside an ongoing transaction under AuditHead row lock.
 */
export async function appendAuditEntry(
  tx: any,
  params: Omit<AuditEntryFields, 'prev_hash' | 'created_at'> & {
    created_at?: string;
  }
) {
  // Lock AuditHead row id=1
  let head = await tx.auditHead.findUnique({
    where: { id: 1 },
  });

  if (!head) {
    head = await tx.auditHead.create({
      data: {
        id: 1,
        lastHash: INITIAL_PREV_HASH,
      },
    });
  }

  const prevHash = head.lastHash;
  const createdAt = params.created_at || new Date().toISOString();

  const fields: AuditEntryFields = {
    ...params,
    prev_hash: prevHash,
    created_at: createdAt,
  };

  const jsonStr = canonicalAuditJson(fields);
  const entryHash = computeEntryHash(jsonStr);

  // Check unique sourceKey to avoid duplicate append
  const existing = await tx.auditEntry.findUnique({
    where: { sourceKey: params.source_key },
  });
  if (existing) {
    return existing;
  }

  // Scoped mission projection (Finding R07, G2-19, G2-20)
  let missionSlug: string | null = null;
  let missionSequence: number | null = null;
  let missionPrevHash: string | null = null;
  let missionEntryHash: string | null = null;
  let missionCanonicalJson: string | null = null;

  if (params.mission_id) {
    let mission = await tx.mission.findUnique({
      where: { slug: params.mission_id },
    });
    if (mission) {
      // Ensure all historical legacy entries are backfilled first so new entry never skips legacy entries (M5-03, Req 6)
      const unprojectedLegacy = tx.auditEntry?.findFirst ? await tx.auditEntry.findFirst({
        where: {
          OR: [
            { missionSlug: params.mission_id, missionEntryHash: null },
            { canonicalJson: { contains: `"mission_id":"${params.mission_id}"` }, missionEntryHash: null },
          ],
        },
      }) : null;
      if (unprojectedLegacy) {
        await backfillMissionAuditProjections(tx, params.mission_id);
        mission = await tx.mission.findUnique({
          where: { slug: params.mission_id },
        });
      }

      missionSlug = mission.slug;
      missionPrevHash = mission.auditHeadHash || INITIAL_PREV_HASH;
      missionSequence = (mission.auditEntryCount || 0) + 1;

      const prevForMission = missionPrevHash || INITIAL_PREV_HASH;
      const missionFields: AuditEntryFields = {
        ...params,
        prev_hash: prevForMission,
        created_at: createdAt,
      };
      missionCanonicalJson = canonicalAuditJson(missionFields);
      missionEntryHash = computeEntryHash(missionCanonicalJson);

      await tx.mission.update({
        where: { slug: params.mission_id },
        data: {
          auditHeadHash: missionEntryHash,
          auditEntryCount: missionSequence,
        },
      });
    }
  }

  const entry = await tx.auditEntry.create({
    data: {
      sourceKey: params.source_key,
      prevHash,
      entryHash,
      canonicalJson: jsonStr,
      missionSlug,
      missionSequence,
      missionPrevHash,
      missionEntryHash,
      missionCanonicalJson,
      createdAt: new Date(createdAt),
    },
  });

  // Update head
  await tx.auditHead.update({
    where: { id: 1 },
    data: { lastHash: entryHash },
  });

  return entry;
}

export interface VerifyProofResult {
  valid: boolean;
  totalEntries: number;
  headHash: string;
  errors: string[];
}

export function verifyAuditChain(
  entries: Array<{
    sourceKey: string;
    prevHash: string;
    entryHash: string;
    canonicalJson: string;
  }>,
  expectedHeadHash?: string,
  checkpoint?: { entryCount: number; headHash: string } | null,
  expectedResult?: { operationId?: string; resultHash?: string; result?: string }
): VerifyProofResult {
  const errors: string[] = [];
  const seenSourceKeys = new Set<string>();
  let currentPrevHash = INITIAL_PREV_HASH;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];

    if (!e.sourceKey || !e.entryHash || !e.canonicalJson || !e.prevHash) {
      errors.push(`Entry ${i} is missing required fields`);
      continue;
    }

    if (seenSourceKeys.has(e.sourceKey)) {
      errors.push(`Duplicate sourceKey at entry ${i}: ${e.sourceKey}`);
    }
    seenSourceKeys.add(e.sourceKey);

    if (e.prevHash.toLowerCase() !== currentPrevHash.toLowerCase()) {
      errors.push(
        `Chain break at index ${i}: expected prevHash ${currentPrevHash}, got ${e.prevHash}`
      );
    }

    // Verify outer entryHash matches computed hash of canonicalJson
    const computedHash = computeEntryHash(e.canonicalJson);
    if (computedHash.toLowerCase() !== e.entryHash.toLowerCase()) {
      errors.push(
        `Hash mismatch at index ${i}: computed ${computedHash}, declared ${e.entryHash}`
      );
    }

    // Parse canonicalJson and enforce inner/outer equality (Finding F11)
    let parsed: any;
    try {
      parsed = JSON.parse(e.canonicalJson);
    } catch (parseErr: any) {
      errors.push(`Invalid JSON at index ${i}: ${parseErr.message}`);
      continue;
    }

    if (parsed.source_key !== e.sourceKey) {
      errors.push(
        `Inner/outer sourceKey mismatch at index ${i}: inner '${parsed.source_key}' != outer '${e.sourceKey}'`
      );
    }

    if ((parsed.prev_hash || '').toLowerCase() !== e.prevHash.toLowerCase()) {
      errors.push(
        `Inner/outer prevHash mismatch at index ${i}: inner '${parsed.prev_hash}' != outer '${e.prevHash}'`
      );
    }

    currentPrevHash = e.entryHash;
  }

  const targetHead = expectedHeadHash || checkpoint?.headHash;
  if (targetHead && currentPrevHash.toLowerCase() !== targetHead.toLowerCase()) {
    errors.push(
      `Head hash mismatch: expected ${targetHead}, got ${currentPrevHash}`
    );
  }

  if (checkpoint && checkpoint.entryCount !== entries.length) {
    errors.push(
      `Entry count mismatch: checkpoint ${checkpoint.entryCount} != actual ${entries.length}`
    );
  }

  if (expectedResult) {
    let matchedOp = false;
    for (let i = entries.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(entries[i].canonicalJson);
        if (
          (!expectedResult.operationId || parsed.operation_id === expectedResult.operationId) &&
          parsed.result_hash
        ) {
          matchedOp = true;
          let expectedHash = expectedResult.resultHash;
          if (!expectedHash && expectedResult.result) {
            expectedHash = keccak256(stringToBytes(expectedResult.result));
          }
          if (expectedHash && parsed.result_hash.toLowerCase() !== expectedHash.toLowerCase()) {
            errors.push(
              `Result hash mismatch: expected ${expectedHash}, got ${parsed.result_hash}`
            );
          }
          break;
        }
      } catch {}
    }
    if (!matchedOp && (expectedResult.resultHash || expectedResult.result)) {
      errors.push('No matching operation found with result_hash');
    }
  }

  return {
    valid: errors.length === 0,
    totalEntries: entries.length,
    headHash: currentPrevHash,
    errors,
  };
}

/**
 * Persisted backfill service for legacy audit entries (V4-03).
 * Must be executed as an explicit administrative/migration action, never as a side effect of GET requests.
 */
export async function backfillMissionAuditProjections(
  tx: any,
  targetMissionSlug?: string
): Promise<{ projectedCount: number; missionsUpdated: string[] }> {
  const whereMission = targetMissionSlug ? { slug: targetMissionSlug } : {};
  const missions = await tx.mission.findMany({
    where: whereMission,
    orderBy: { createdAt: 'asc' },
  });

  let totalProjected = 0;
  const missionsUpdated: string[] = [];

  for (const mission of missions) {
    const slug = mission.slug;
    const entries = await tx.auditEntry.findMany({
      where: {
        OR: [
          { missionSlug: slug },
          { canonicalJson: { contains: `"mission_id":"${slug}"` } },
        ],
      },
      orderBy: { id: 'asc' },
    });

    if (entries.length === 0) continue;

    // Step 1: Validate source integrity before deriving projection (M5-03)
    for (const e of entries) {
      const computedSource = computeEntryHash(e.canonicalJson);
      if (computedSource !== e.entryHash) {
        throw new Error(
          `AUDIT_SOURCE_INTEGRITY_VIOLATION: Entry ${e.sourceKey} hash mismatch during backfill`
        );
      }
    }

    // Step 2: Phase 1 - release existing sequence assignments to prevent unique collision (M6-01)
    if (tx.auditEntry.updateMany) {
      await tx.auditEntry.updateMany({
        where: {
          OR: [
            { missionSlug: slug, missionSequence: { not: null } },
            { id: { in: entries.map((e: any) => e.id) }, missionSequence: { not: null } },
          ],
        },
        data: { missionSequence: null },
      });
    } else {
      for (const e of entries) {
        if (e.missionSequence !== null && e.missionSequence !== undefined) {
          await tx.auditEntry.update({
            where: { id: e.id },
            data: { missionSequence: null },
          });
        }
      }
    }

    // Step 3: Phase 2 - assign final deterministic continuous sequence and companion hashes
    let curHead = INITIAL_PREV_HASH;
    let seq = 0;

    for (const e of entries) {
      seq++;
      const prev = curHead;
      const parsed = JSON.parse(e.canonicalJson);
      parsed.prev_hash = prev;
      const canon = canonicalAuditJson(parsed);
      const hash = computeEntryHash(canon);
      curHead = hash;

      await tx.auditEntry.update({
        where: { id: e.id },
        data: {
          missionSlug: slug,
          missionSequence: seq,
          missionPrevHash: prev,
          missionEntryHash: hash,
          missionCanonicalJson: canon,
        },
      });
      totalProjected++;
    }

    await tx.mission.update({
      where: { slug },
      data: {
        auditHeadHash: curHead,
        auditEntryCount: seq,
      },
    });

    missionsUpdated.push(slug);
  }

  return { projectedCount: totalProjected, missionsUpdated };
}
