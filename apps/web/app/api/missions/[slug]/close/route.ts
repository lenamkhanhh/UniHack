import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { runMissionValidatorJob } from '@/lib/validator-job';

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

    // M7: Trigger automated independent validator job upon mission close
    let validationResult: any = null;
    try {
      const isLiveFuji = process.env.PAYMENT_MODE === 'LIVE_FUJI';
      const jobResult = await runMissionValidatorJob(slug, {
        skipOnChainBroadcast: !isLiveFuji,
      });
      validationResult = {
        requestHash: jobResult.requestHash,
        score: jobResult.validationResult.score,
        tag: jobResult.validationResult.tag,
        valid: jobResult.validationResult.valid,
        status: jobResult.status,
        isRegisteredOnChain: jobResult.isRegisteredOnChain,
        responseTxHash: jobResult.responseTxHash,
        requestTxHash: jobResult.requestTxHash,
        unsignedRequest: jobResult.unsignedRequest,
      };
    } catch (jobErr) {
      // Soft-fail validation runner so close operation is never blocked
      console.warn('[Validator Auto Job Warning]', jobErr);
    }

    return NextResponse.json({
      success: true,
      status: 'CLOSED',
      validation: validationResult,
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
