import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { appendAuditEntry } from '@/lib/audit';
import { encodeFunctionData, parseAbiItem } from 'viem';
import { verifyAnchorReceiptOnFuji } from '@/lib/fuji-receipts';
import { validateLiveFujiConfig } from '@/lib/config';

const anchorMissionProofAbi = parseAbiItem(
  'function anchorMissionProof(bytes32 missionId, bytes32 headHash) external'
);

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

        // WIRE-01: In Stage S2, wire proof anchoring into completion lifecycle
        if (challengeResult.state.stage === 'S2') {
          const latestEntry = await tx.auditEntry.findFirst({
            where: { missionSlug: slug },
            orderBy: { missionSequence: 'desc' },
          });

          const headHash = latestEntry?.entryHash || deliverableHash;
          if (challengeResult.state.paymentMode === 'LIVE_FUJI') {
            await validateLiveFujiConfig();
          }
          const rawTreasury = (
            challengeResult.state.guardAddress ||
            process.env.GUARDED_TREASURY_ADDRESS
          )?.trim();
          const guardedTreasuryAddress = (rawTreasury ||
            '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3') as `0x${string}`;

          const missionIdBytes32 = (
            mission.missionId.startsWith('0x')
              ? mission.missionId.padEnd(66, '0')
              : `0x${mission.missionId}`.padEnd(66, '0')
          ) as `0x${string}`;

          const headHashBytes32 = (
            headHash.startsWith('0x')
              ? headHash.padEnd(66, '0')
              : `0x${headHash}`.padEnd(66, '0')
          ) as `0x${string}`;

          const anchorCalldata = encodeFunctionData({
            abi: [anchorMissionProofAbi],
            functionName: 'anchorMissionProof',
            args: [missionIdBytes32, headHashBytes32],
          });

          const unsignedTx = {
            to: guardedTreasuryAddress,
            data: anchorCalldata,
            value: '0',
            chainId: 43113,
          };

          const anchorTxHash = payload.anchorTxHash || (body as any).anchorTxHash;

          if (challengeResult.state.paymentMode === 'LIVE_FUJI') {
            if (anchorTxHash) {
              const verification = await verifyAnchorReceiptOnFuji({
                txHash: anchorTxHash,
                missionId: mission.missionId,
                expectedHeadHash: headHash,
                treasuryAddress: guardedTreasuryAddress,
              });

              if (!verification.valid) {
                throw new ChallengeError(`On-chain anchor verification failed: ${verification.error}`, 400);
              }

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
                source_key: `anchor:${mission.slug}:${anchorTxHash}`,
                to: guardedTreasuryAddress,
                tx_hash: anchorTxHash,
              });

              anchoredProofInfo = {
                headHash,
                missionId: mission.missionId,
                mode: 'LIVE_FUJI',
                txHash: anchorTxHash,
                anchored: true,
                status: 'ANCHORED',
              };
            } else {
              anchoredProofInfo = {
                headHash,
                missionId: mission.missionId,
                mode: 'LIVE_FUJI',
                txHash: null,
                anchored: false,
                status: 'PENDING_ONCHAIN_ANCHOR',
                unsignedTx,
              };
            }
          } else {
            // MOCK mode: Do not write false on-chain events to audit ledger
            anchoredProofInfo = {
              headHash,
              missionId: mission.missionId,
              mode: 'MOCK',
              txHash: null,
              anchored: false,
              status: 'ANCHOR_MOCK_NOT_SENT',
              unsignedTx,
            };
          }
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
