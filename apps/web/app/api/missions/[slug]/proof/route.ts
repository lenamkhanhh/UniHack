import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { toOperationDto, toMissionDto } from '@/lib/dto';
import { INITIAL_PREV_HASH, canonicalAuditJson, computeEntryHash } from '@/lib/audit';
import { Prisma } from '@prisma/client';

export async function GET(
  req: NextRequest,
  context: any
) {
  try {
    const { slug } = await context.params;
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const isPublic = req.nextUrl.searchParams.get('public') === 'true';

    let claims: any = null;
    if (token) {
      try {
        claims = await verifyToken(token);
      } catch {
        // invalid token
      }
    }

    // Atomic read-only snapshot transaction with RepeatableRead isolation (V4-02, V4-05)
    // Strictly zero writes inside GET handler!
    const snapshot = await prisma.$transaction(
      async (tx) => {
        const mission = await tx.mission.findUnique({
          where: { slug },
          include: {
            operations: {
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        if (!mission) {
          return null;
        }

        // Authorization check INSIDE snapshot before any data exposure (V4-02)
        const hasAuthorizedToken = Boolean(claims && claims.missionSlug === slug);
        if (!hasAuthorizedToken && (!isPublic || !mission.publicPublished)) {
          return { unauthorized: true, mission: null, entries: [] };
        }

        // Strictly read-only query for mission entries ordered chronologically by ID (M5-03)
        const entries = await tx.auditEntry.findMany({
          where: {
            OR: [
              { missionSlug: slug },
              { canonicalJson: { contains: `"mission_id":"${slug}"` } },
            ],
          },
          orderBy: [
            { id: 'asc' },
          ],
        });

        return { unauthorized: false, mission, entries, hasAuthorizedToken };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );

    if (!snapshot) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (snapshot.unauthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: scoped credential required for private mission proof' },
        { status: 401 }
      );
    }

    const { mission, entries: missionEntries, hasAuthorizedToken } = snapshot;
    if (!mission) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Validate source integrity of all entries (M5-03, Case B)
    // Never silently rehash tampered rows!
    for (let i = 0; i < missionEntries.length; i++) {
      const e = missionEntries[i];
      const computedGlobalHash = computeEntryHash(e.canonicalJson);
      if (computedGlobalHash !== e.entryHash) {
        return NextResponse.json(
          {
            error: `AUDIT_SOURCE_INTEGRITY_VIOLATION: Entry ${e.sourceKey} hash mismatch (tampered canonicalJson)`,
          },
          { status: 409 }
        );
      }
      if (e.missionEntryHash && e.missionCanonicalJson) {
        const computedCompanion = computeEntryHash(e.missionCanonicalJson);
        if (computedCompanion !== e.missionEntryHash) {
          return NextResponse.json(
            {
              error: `AUDIT_COMPANION_INTEGRITY_VIOLATION: Entry ${e.sourceKey} mission hash mismatch`,
            },
            { status: 409 }
          );
        }
      }
    }

    const hasAnyLegacy = missionEntries.some((e: any) => !e.missionEntryHash);
    const hasAnyProjected = missionEntries.some((e: any) => Boolean(e.missionEntryHash));

    // Reject mixed/incomplete projections (M5-03, Case A)
    // Auto-blending creates inconsistent root hashes or broken chronology
    if (hasAnyLegacy && hasAnyProjected) {
      return NextResponse.json(
        {
          error:
            'AUDIT_PROJECTION_INCOMPLETE: Mission contains unprojected legacy entries alongside projected entries. Backfill required before export.',
        },
        { status: 409 }
      );
    }

    let scopedAuditEntries = [];
    let ledgerScope = 'mission';
    let checkpointHeadHash = INITIAL_PREV_HASH;
    let checkpointEntryCount = 0;

    if (!hasAnyLegacy) {
      // Fully projected mission: must validate strictly against persisted checkpoint (M6-02)
      const persistedCount = Number(mission.auditEntryCount ?? 0);
      const persistedHead = (mission.auditHeadHash || INITIAL_PREV_HASH).toLowerCase();

      // 1. Strict sequence continuity check (1..N contiguous, no gaps or duplicates)
      let expectedPrevHash = INITIAL_PREV_HASH.toLowerCase();
      for (let i = 0; i < missionEntries.length; i++) {
        const e = missionEntries[i];
        const expectedSeq = i + 1;
        if (e.missionSequence !== expectedSeq) {
          return NextResponse.json(
            {
              error: `AUDIT_CHECKPOINT_MISMATCH: Sequence broken at index ${i}: expected ${expectedSeq}, got ${e.missionSequence}`,
            },
            { status: 409 }
          );
        }
        if ((e.missionPrevHash || '').toLowerCase() !== expectedPrevHash) {
          return NextResponse.json(
            {
              error: `AUDIT_CHECKPOINT_MISMATCH: Hash chain broken at index ${i}: expected prevHash ${expectedPrevHash}, got ${e.missionPrevHash}`,
            },
            { status: 409 }
          );
        }
        expectedPrevHash = (e.missionEntryHash || '').toLowerCase();
      }

      // 2. Exact match against persisted count (catches truncation / missing tail entries)
      if (missionEntries.length !== persistedCount) {
        return NextResponse.json(
          {
            error: `AUDIT_CHECKPOINT_MISMATCH: Exported entry count (${missionEntries.length}) does not match persisted auditEntryCount (${persistedCount})`,
          },
          { status: 409 }
        );
      }

      // 3. Exact match against persisted head hash
      const lastEntryHead =
        missionEntries.length > 0
          ? (missionEntries[missionEntries.length - 1].missionEntryHash || INITIAL_PREV_HASH).toLowerCase()
          : INITIAL_PREV_HASH.toLowerCase();

      if (lastEntryHead !== persistedHead) {
        return NextResponse.json(
          {
            error: `AUDIT_CHECKPOINT_MISMATCH: Computed head hash (${lastEntryHead}) does not match persisted auditHeadHash (${persistedHead})`,
          },
          { status: 409 }
        );
      }

      scopedAuditEntries = missionEntries.map((e: any) => ({
        sourceKey: e.sourceKey,
        prevHash: e.missionPrevHash,
        entryHash: e.missionEntryHash,
        canonicalJson: e.missionCanonicalJson || e.canonicalJson,
      }));

      checkpointHeadHash = mission.auditHeadHash || INITIAL_PREV_HASH;
      checkpointEntryCount = persistedCount;
    } else {
      // Pure legacy mission: derive projection in chronological order (id: asc)
      ledgerScope = 'mission-legacy-derived';
      let curPrev = INITIAL_PREV_HASH;
      for (let i = 0; i < missionEntries.length; i++) {
        const e = missionEntries[i];
        const parsed = JSON.parse(e.canonicalJson);
        parsed.prev_hash = curPrev;
        const canon = canonicalAuditJson(parsed);
        const entryHash = computeEntryHash(canon);
        scopedAuditEntries.push({
          sourceKey: e.sourceKey,
          prevHash: curPrev,
          entryHash,
          canonicalJson: canon,
        });
        curPrev = entryHash;
      }
      checkpointHeadHash =
        scopedAuditEntries.length > 0
          ? scopedAuditEntries[scopedAuditEntries.length - 1].entryHash
          : INITIAL_PREV_HASH;
      checkpointEntryCount = scopedAuditEntries.length;
    }

    // Checkpoint timestamp: use the timestamp of the last entry or mission completion, not creation (M5-03)
    let checkpointTimestamp = mission.completedAt || mission.createdAt;
    if (scopedAuditEntries.length > 0) {
      try {
        const lastParsed = JSON.parse(
          scopedAuditEntries[scopedAuditEntries.length - 1].canonicalJson
        );
        if (lastParsed.created_at) {
          checkpointTimestamp = new Date(lastParsed.created_at);
        }
      } catch {}
    }

    return NextResponse.json({
      schemaVersion: 1,
      ledgerScope,
      missionSlug: mission.slug,
      mission: toMissionDto(mission),
      operations: mission.operations.map((op: any) =>
        toOperationDto(op, { includeResult: Boolean(hasAuthorizedToken && !isPublic) })
      ),
      audit: {
        checkpoint: {
          headHash: checkpointHeadHash,
          entryCount: checkpointEntryCount,
          lastIndexedSequence: checkpointEntryCount,
          checkpointTimestamp,
        },
        entries: scopedAuditEntries,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
