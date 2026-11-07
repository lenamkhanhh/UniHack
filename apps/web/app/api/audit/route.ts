import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { INITIAL_PREV_HASH } from '@/lib/audit';
import { verifyToken } from '@/lib/auth';
import { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    let claims = null;
    if (token) {
      try {
        claims = await verifyToken(token);
      } catch {
        // invalid token
      }
    }

    // Scoped access for mission token (Finding R08, T06, V4-05)
    if (claims?.missionSlug) {
      const missionSlug = claims.missionSlug;
      const snapshot = await prisma.$transaction(
        async (tx) => {
          const mission = await tx.mission.findUnique({
            where: { slug: missionSlug },
          });
          const missionEntries = await tx.auditEntry.findMany({
            where: { missionSlug },
            orderBy: { missionSequence: 'asc' },
          });
          return { mission, missionEntries };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      );

      const entries = snapshot.missionEntries;
      const headHash =
        entries.length > 0
          ? entries[entries.length - 1].missionEntryHash || entries[entries.length - 1].entryHash
          : (snapshot.mission?.auditHeadHash || INITIAL_PREV_HASH);

      return NextResponse.json({
        scope: 'mission',
        missionSlug,
        checkpoint: {
          headHash,
          entryCount: entries.length,
        },
        entries: entries.map((e) => ({
          id: e.id?.toString() ?? '0',
          sourceKey: e.sourceKey,
          prevHash: e.missionPrevHash || e.prevHash,
          entryHash: e.missionEntryHash || e.entryHash,
          canonicalJson: e.missionCanonicalJson || e.canonicalJson,
          createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
        })),
      });
    }

    const urlMissionSlug = req.nextUrl.searchParams.get('missionSlug');
    const isFeed = req.nextUrl.searchParams.get('feed') === '1';

    if (isFeed || urlMissionSlug) {
      const whereClause: any = {};
      if (urlMissionSlug && urlMissionSlug !== 'all') {
        whereClause.missionSlug = urlMissionSlug;
      }
      const rawEntries = await prisma.auditEntry.findMany({
        where: whereClause,
        orderBy: { id: 'desc' },
        take: 20,
      });

      return NextResponse.json({
        scope: isFeed ? 'feed' : 'mission_param',
        entries: rawEntries.map((e) => ({
          id: e.id?.toString() ?? '0',
          sourceKey: e.sourceKey,
          prevHash: e.missionPrevHash || e.prevHash,
          entryHash: e.missionEntryHash || e.entryHash,
          canonicalJson: e.missionCanonicalJson || e.canonicalJson,
          createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
        })),
      });
    }

    // Public caller: return scoped bundles for explicitly published missions (Finding T06, V4-05)
    // Entire snapshot wrapped in single RepeatableRead transaction
    const bundles = await prisma.$transaction(
      async (tx) => {
        const publishedMissions = await tx.mission.findMany({
          where: { publicPublished: true },
          select: { slug: true, auditHeadHash: true, auditEntryCount: true },
          orderBy: { createdAt: 'desc' },
        });

        if (publishedMissions.length === 0) {
          return [];
        }

        const publishedSlugs = publishedMissions.map((m) => m.slug);
        const allEntries = await tx.auditEntry.findMany({
          where: { missionSlug: { in: publishedSlugs } },
          orderBy: { missionSequence: 'asc' },
        });

        const entriesBySlug = new Map<string, typeof allEntries>();
        for (const e of allEntries) {
          if (!e.missionSlug) continue;
          if (!entriesBySlug.has(e.missionSlug)) {
            entriesBySlug.set(e.missionSlug, []);
          }
          entriesBySlug.get(e.missionSlug)!.push(e);
        }

        return publishedMissions.map((m) => {
          const mEntries = entriesBySlug.get(m.slug) || [];
          const headHash =
            mEntries.length > 0
              ? mEntries[mEntries.length - 1].missionEntryHash || mEntries[mEntries.length - 1].entryHash
              : (m.auditHeadHash || INITIAL_PREV_HASH);

          return {
            missionSlug: m.slug,
            checkpoint: {
              headHash,
              entryCount: mEntries.length,
            },
            entries: mEntries.map((e) => ({
              id: e.id?.toString() ?? '0',
              sourceKey: e.sourceKey,
              prevHash: e.missionPrevHash || e.prevHash,
              entryHash: e.missionEntryHash || e.entryHash,
              canonicalJson: e.missionCanonicalJson || e.canonicalJson,
              createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
            })),
          };
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );

    return NextResponse.json({
      scope: 'public_curated',
      publishedCount: bundles.length,
      bundles,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
