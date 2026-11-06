import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';

export async function POST(
  req: NextRequest,
  context: any
) {
  try {
    const { slug } = await context.params;
    const body = await req.json();
    const { nonce, signature, payload } = body;

    if (!nonce || !signature || !payload) {
      return NextResponse.json(
        { error: 'nonce, signature, and payload are required' },
        { status: 400 }
      );
    }

    const { deliverableHash } = payload;
    if (!deliverableHash) {
      return NextResponse.json({ error: 'deliverableHash is required' }, { status: 400 });
    }

    const mission = await prisma.mission.findUnique({
      where: { slug },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';
    const now = new Date();

    const updated = await withLockOrder(
      async (tx) => {
        await verifyAndConsumeChallenge(tx, {
          nonce,
          signature,
          action: 'COMPLETE_MISSION',
          payload,
          expectedSigner: mission.ownerAddress,
          targetMissionSlug: slug,
          targetMissionId: mission.missionId,
          appOrigin,
        });

        return await tx.mission.update({
          where: { slug },
          data: {
            deliverableHash,
            completedAt: now,
          },
        });
      },
      { missionSlug: slug }
    );

    return NextResponse.json({
      mission: {
        slug: updated.slug,
        status: updated.status,
        completedAt: updated.completedAt,
        deliverableHash: updated.deliverableHash,
      },
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
