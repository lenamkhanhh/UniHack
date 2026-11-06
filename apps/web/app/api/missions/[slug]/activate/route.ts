import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { issueSpendToken } from '@/lib/auth';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { getSessionWalletForMission } from '@/lib/session-wallets';
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

    let sessionWalletInfo: any = null;

    const { state } = await prisma.$transaction(async (tx) => {
      const res = await verifyAndConsumeChallenge(tx, {
        nonce,
        signature,
        action: 'ACTIVATE',
        payload,
        expectedSigner: mission.ownerAddress,
        targetMissionSlug: slug,
        targetMissionId: mission.missionId,
        appOrigin,
      });

      // P1-WIRE: In Stage S2, wire session wallet funding into activation lifecycle
      if (res.state.stage === 'S2') {
        const sessionWallet = getSessionWalletForMission(mission.slug);
        sessionWalletInfo = {
          address: sessionWallet.address,
          toolCap: mission.toolCap.toString(),
          funded: true,
          mode: res.state.paymentMode,
          txHash: null, // Honest null in MOCK mode (ERC-02 / SW-01)
        };

        await appendAuditEntry(tx, {
          actor: mission.ownerAddress,
          amount: mission.toolCap.toString(),
          chain_id: '43113',
          kind: 'SESSION_WALLET_FUNDED',
          mission_id: mission.slug,
          operation_id: '',
          policy_hash: mission.policyHash,
          policy_version: '1',
          reason: 'Fund on-chain session wallet with mission toolCap',
          result_hash: '',
          rule: 'STAGE_S2_SESSION_WALLET_FUNDED',
          source_key: `fund:${mission.slug}:${nonce}`,
          to: sessionWallet.address,
          tx_hash: '',
        });
      }

      return res;
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
      sessionWallet: sessionWalletInfo,
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
