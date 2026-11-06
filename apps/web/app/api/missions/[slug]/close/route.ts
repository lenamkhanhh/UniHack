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

    const mission = await prisma.mission.findUnique({
      where: { slug },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

    await withLockOrder(
      async (tx) => {
        await verifyAndConsumeChallenge(tx, {
          nonce,
          signature,
          action: 'CLOSE_MISSION_S1',
          payload,
          expectedSigner: mission.ownerAddress,
          targetMissionSlug: slug,
          targetMissionId: mission.missionId,
          appOrigin,
        });

        await tx.mission.update({
          where: { slug },
          data: { status: 'CLOSED' },
        });
      },
      { missionSlug: slug }
    );

    return NextResponse.json({ success: true, status: 'CLOSED' });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
