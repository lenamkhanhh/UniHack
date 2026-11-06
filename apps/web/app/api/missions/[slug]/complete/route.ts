import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { appendAuditEntry } from '@/lib/audit';

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

    let anchoredProofInfo: any = null;

    const updated = await withLockOrder(
      async (tx) => {
        const challengeResult = await verifyAndConsumeChallenge(tx, {
          nonce,
          signature,
          action: 'COMPLETE_MISSION',
          payload,
          expectedSigner: mission.ownerAddress,
          targetMissionSlug: slug,
          targetMissionId: mission.missionId,
          appOrigin,
        });

        // P1-WIRE: In Stage S2, wire proof anchoring into completion lifecycle
        if (challengeResult.state.stage === 'S2') {
          const latestEntry = await tx.auditEntry.findFirst({
            where: { missionSlug: slug },
            orderBy: { missionSequence: 'desc' },
          });

          const headHash = latestEntry?.entryHash || deliverableHash;
          anchoredProofInfo = {
            headHash,
            missionId: mission.missionId,
            mode: challengeResult.state.paymentMode,
            txHash: null, // Honest null in MOCK mode (ERC-02)
            anchored: true,
          };

          await appendAuditEntry(tx, {
            actor: mission.ownerAddress,
            amount: '0',
            chain_id: '43113',
            kind: 'PROOF_ANCHORED',
            mission_id: mission.slug,
            operation_id: '',
            policy_hash: mission.policyHash,
            policy_version: '1',
            reason: 'Anchor proof headHash to GuardedTreasury',
            result_hash: '',
            rule: 'STAGE_S2_PROOF_ANCHOR',
            source_key: `anchor:${mission.slug}:${nonce}`,
            to: challengeResult.state.guardAddress || '',
            tx_hash: '',
          });
        }

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
      anchoredProof: anchoredProofInfo,
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
