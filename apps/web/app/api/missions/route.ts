import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeAddress, hashUtf8 } from '@/lib/chain';
import { getConfiguredOwner } from '@/lib/config';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { toMissionDto } from '@/lib/dto';
import { verifyToken } from '@/lib/auth';
import { saveMissionPayees, buildSetMissionPayeeRootCalldata } from '@/lib/merkle';

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

    if (claims?.missionSlug) {
      const missions = await prisma.mission.findMany({
        where: { slug: claims.missionSlug },
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ missions: missions.map(toMissionDto) });
    }

    // Public listing only includes publicPublished missions (Finding R08)
    const missions = await prisma.mission.findMany({
      where: { publicPublished: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ missions: missions.map(toMissionDto) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nonce, signature, payload } = body;

    if (!nonce || !signature || !payload) {
      return NextResponse.json(
        { error: 'nonce, signature, and payload are required' },
        { status: 400 }
      );
    }

    const { slug, agentAddress, treasuryCap, toolCap, durationSeconds } = payload;
    if (!slug || !agentAddress || !treasuryCap || !toolCap || !durationSeconds) {
      return NextResponse.json(
        { error: 'slug, agentAddress, treasuryCap, toolCap, durationSeconds are required in payload' },
        { status: 400 }
      );
    }

    const configuredOwner = getConfiguredOwner();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);
    const missionId = hashUtf8(slug);
    const policyHash = hashUtf8(`policy:1:${treasuryCap}:${toolCap}`);

    const result = await prisma.$transaction(async (tx) => {
      await verifyAndConsumeChallenge(tx, {
        nonce,
        signature,
        action: 'CREATE_MISSION',
        payload,
        expectedSigner: configuredOwner,
        targetMissionSlug: slug,
      });

      const mission = await tx.mission.create({
        data: {
          slug,
          missionId,
          ownerAddress: configuredOwner,
          agentAddress: normalizeAddress(agentAddress),
          treasuryCap: treasuryCap.toString(),
          toolCap: toolCap.toString(),
          spentTool: '0',
          reservedTool: '0',
          expiresAt,
          status: 'ACTIVE',
          configVersion: 1,
          policyHash,
        },
      });

      return mission;
    });

    let payeeInfo: any = null;
    if (Array.isArray(payload.payees) && payload.payees.length > 0) {
      const treeResult = saveMissionPayees(slug, payload.payees);
      const guardedTreasuryAddress =
        process.env.NEXT_PUBLIC_GUARDED_TREASURY_ADDRESS ||
        '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3';
      const unsignedTx = {
        to: guardedTreasuryAddress,
        data: buildSetMissionPayeeRootCalldata(missionId, treeResult.root),
        value: '0',
        chainId: 43113,
      };

      payeeInfo = {
        root: treeResult.root,
        payees: treeResult.payees,
        status: 'PAYEE_ROOT_MOCK_NOT_SENT',
        unsignedTx,
      };
    }

    return NextResponse.json({ mission: result, payeeInfo }, { status: 201 });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Mission slug or missionId already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
