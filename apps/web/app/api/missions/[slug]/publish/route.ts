import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { getAppOrigin } from '@/lib/config';

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

    const mission = await prisma.mission.findUnique({
      where: { slug },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const appOrigin = getAppOrigin();

    await withLockOrder(
      async (tx) => {
        await verifyAndConsumeChallenge(tx, {
          nonce,
          signature,
          action: 'PUBLISH_MISSION',
          payload,
          expectedSigner: mission.ownerAddress,
          targetMissionSlug: slug,
          targetMissionId: mission.missionId,
          appOrigin,
        });

        await tx.mission.update({
          where: { slug },
          data: {
            publicPublished: Boolean(payload.publicPublished),
            publicationVersion: { increment: 1 },
          },
        });
      },
      { missionSlug: slug }
    );

    return NextResponse.json({
      success: true,
      slug,
      publicPublished: Boolean(payload.publicPublished),
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
