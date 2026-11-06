import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeAddress } from '@/lib/chain';
import { CHAIN_ID, REPUTATION_REGISTRY } from '@/lib/constants';
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

    const { deliverableHash, agentId, score } = payload;
    if (!deliverableHash || !agentId || score === undefined) {
      return NextResponse.json(
        { error: 'deliverableHash, agentId, and score are required in payload' },
        { status: 400 }
      );
    }

    const mission = await prisma.mission.findUnique({ where: { slug } });
    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

    // Atomically consume challenge & record prepared feedback
    const feedback = await prisma.$transaction(async (tx) => {
      await verifyAndConsumeChallenge(tx, {
        nonce,
        signature,
        action: 'PREPARE_FEEDBACK',
        payload,
        expectedSigner: mission.ownerAddress,
        targetMissionSlug: slug,
        targetMissionId: mission.missionId,
        appOrigin,
      });

      return await tx.missionFeedback.upsert({
        where: { missionSlug: slug },
        create: {
          missionSlug: slug,
          agentId,
          chainId: CHAIN_ID,
          registry: REPUTATION_REGISTRY,
          clientAddress: normalizeAddress(mission.ownerAddress),
          preparedValue: score,
          preparedResultHash: deliverableHash,
          state: 'PREPARED',
        },
        update: {
          preparedValue: score,
          preparedResultHash: deliverableHash,
          state: 'PREPARED',
        },
      });
    });

    return NextResponse.json({ feedback });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
