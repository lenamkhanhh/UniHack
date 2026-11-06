import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { issueSpendToken } from '@/lib/auth';
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

    if (mission.status !== 'ACTIVE' || new Date() >= mission.expiresAt) {
      return NextResponse.json(
        { error: 'Cannot activate inactive or expired mission' },
        { status: 400 }
      );
    }

    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

    const { state } = await prisma.$transaction(async (tx) => {
      return await verifyAndConsumeChallenge(tx, {
        nonce,
        signature,
        action: 'ACTIVATE',
        payload,
        expectedSigner: mission.ownerAddress,
        targetMissionSlug: slug,
        targetMissionId: mission.missionId,
        appOrigin,
      });
    });

    // Issue spend token
    const spendToken = await issueSpendToken({
      deploymentId: state.deploymentId,
      stage: state.stage as 'S1' | 'S2',
      guardAddress: state.guardAddress,
      authVersion: state.authVersion,
      missionSlug: mission.slug,
      missionId: mission.missionId,
      ownerAddress: mission.ownerAddress,
      agentAddress: mission.agentAddress,
      missionConfigVersion: mission.configVersion,
      policyHash: mission.policyHash,
      missionExpiresAt: mission.expiresAt,
      appOrigin,
    });

    return NextResponse.json({
      spendToken,
      expiresAt: mission.expiresAt.toISOString(),
      type: 'spend',
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
