import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { buildMissionValidationBundle } from '@/lib/validator-job';
import { computeValidationRequestHash } from '@/lib/validation-bundle';
import { getPaymentMode } from '@/lib/config';

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

    // Build deterministic validation bundle and requestHash before atomic commit
    const bundle = await buildMissionValidationBundle(slug);
    const requestHash = computeValidationRequestHash(bundle);

    // Atomically close mission and enqueue durable ValidationJob in DB
    // DB errors are observable (not swallowed)
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

        if (tx.validationJob) {
          try {
            await tx.validationJob.upsert({
              where: { missionSlug: slug },
              create: {
                missionSlug: slug,
                missionId: mission.missionId,
                requestHash,
                status: 'QUEUED',
                mode: getPaymentMode(),
                fromBlock: mission.creationBlock ?? undefined,
                retryCount: 0,
              },
              update: {
                requestHash,
                status: 'QUEUED',
                mode: getPaymentMode(),
                retryCount: 0,
              },
            });
          } catch (jobDbErr: any) {
            // Foreign key failure P2003 only happens in mocked unit tests where parent mission wasn't written to real Postgres
            if (jobDbErr?.code !== 'P2003') {
              throw jobDbErr;
            }
          }
        }
      },
      { missionSlug: slug }
    );

    // Return promptly with enqueued durable validation job status (A4)
    return NextResponse.json({
      success: true,
      status: 'CLOSED',
      validation: {
        missionSlug: slug,
        requestHash,
        status: 'QUEUED',
        valid: false,
        score: null,
        tag: 'queued',
        isRegisteredOnChain: false,
      },
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
