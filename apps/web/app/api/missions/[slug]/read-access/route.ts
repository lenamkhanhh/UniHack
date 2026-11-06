import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { issueReadToken } from '@/lib/auth';
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

    const { state } = await prisma.$transaction(async (tx) => {
      return await verifyAndConsumeChallenge(tx, {
        nonce,
        signature,
        action: 'READ_MISSION',
        payload,
        expectedSigner: mission.ownerAddress,
        targetMissionSlug: slug,
        targetMissionId: mission.missionId,
        appOrigin,
      });
    });

    // Issue read token (15 min TTL, valid even after mission close/expiry)
    const readToken = await issueReadToken({
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
      appOrigin,
    });

    return NextResponse.json({
      readToken,
      expiresInSeconds: 900,
      type: 'read',
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
