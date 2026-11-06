import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { issueSpendToken } from '@/lib/auth';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { getSessionWalletForMission } from '@/lib/session-wallets';
import { appendAuditEntry } from '@/lib/audit';
import { encodeFunctionData, parseAbiItem } from 'viem';
import { verifyFundingReceiptOnFuji } from '@/lib/fuji-receipts';

const fundMissionWalletAbi = parseAbiItem(
  'function fundMissionWallet(bytes32 missionId, address wallet, uint256 amount) external'
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

      // WIRE-01: In Stage S2, wire session wallet funding into activation lifecycle
      if (res.state.stage === 'S2') {
        const sessionWallet = getSessionWalletForMission(mission.slug);
        const guardedTreasuryAddress = (process.env.GUARDED_TREASURY_ADDRESS ||
          '0x0000000000000000000000000000000000000000') as `0x${string}`;

        const missionIdBytes32 = (
          mission.missionId.startsWith('0x')
            ? mission.missionId.padEnd(66, '0')
            : `0x${mission.missionId}`.padEnd(66, '0')
        ) as `0x${string}`;

        const fundCalldata = encodeFunctionData({
          abi: [fundMissionWalletAbi],
          functionName: 'fundMissionWallet',
          args: [
            missionIdBytes32,
            sessionWallet.address as `0x${string}`,
            BigInt(mission.toolCap.toString()),
          ],
        });

        const unsignedTx = {
          to: guardedTreasuryAddress,
          data: fundCalldata,
          value: '0',
          chainId: 43113,
        };

        const fundingTxHash = payload.fundingTxHash || (body as any).fundingTxHash;

        if (res.state.paymentMode === 'LIVE_FUJI') {
          if (fundingTxHash) {
            const verification = await verifyFundingReceiptOnFuji({
              txHash: fundingTxHash,
              missionId: mission.missionId,
              sessionWallet: sessionWallet.address,
              expectedAmount: BigInt(mission.toolCap.toString()),
              treasuryAddress: guardedTreasuryAddress,
            });

            if (!verification.valid) {
              throw new ChallengeError(`On-chain funding verification failed: ${verification.error}`, 400);
            }

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
              source_key: `fund:${mission.slug}:${fundingTxHash}`,
              to: sessionWallet.address,
              tx_hash: fundingTxHash,
            });

            sessionWalletInfo = {
              address: sessionWallet.address,
              toolCap: mission.toolCap.toString(),
              funded: true,
              mode: 'LIVE_FUJI',
              txHash: fundingTxHash,
              status: 'FUNDED',
            };
          } else {
            sessionWalletInfo = {
              address: sessionWallet.address,
              toolCap: mission.toolCap.toString(),
              funded: false,
              mode: 'LIVE_FUJI',
              txHash: null,
              status: 'PENDING_ONCHAIN_FUNDING',
              unsignedTx,
            };
          }
        } else {
          // MOCK mode: Do not write false on-chain events to audit ledger
          sessionWalletInfo = {
            address: sessionWallet.address,
            toolCap: mission.toolCap.toString(),
            funded: false,
            mode: 'MOCK',
            txHash: null,
            status: 'FUNDING_MOCK_NOT_SENT',
            unsignedTx,
          };
        }
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
