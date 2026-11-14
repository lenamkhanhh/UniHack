import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { appendAuditEntry } from '@/lib/audit';
import { submitErc8004Feedback, ERC8004_FUJI_REPUTATION_REGISTRY } from '@/lib/erc8004';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { getErc8004AgentIdForTool } from '@/lib/tools';
import { verifyFeedbackReceiptOnFuji } from '@/lib/fuji-receipts';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nonce, signature, payload } = body;

    // FB-01: Only owner authenticated via EIP-191 challenge can submit feedback
    if (!nonce || !signature || !payload) {
      return NextResponse.json(
        { error: 'nonce, signature, and payload are required' },
        { status: 400 }
      );
    }

    const { operationId, score = 87, tag1 = 'starred', tag2 = 'unihack-s2', txHash } = payload;

    if (!operationId) {
      return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
    }

    const op = await prisma.toolOperation.findUnique({
      where: { operationId },
    });

    if (!op) {
      return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
    }

    const mission = await prisma.mission.findUnique({
      where: { slug: op.missionSlug },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    // FB-01: Anti-replay / Exactly 1 feedback per operation
    const sourceKey = `erc8004:feedback:${operationId}`;
    const existingFeedback = await prisma.auditEntry.findUnique({
      where: { sourceKey },
    });

    if (existingFeedback) {
      return NextResponse.json(
        { error: 'Feedback already submitted for this operation' },
        { status: 409 }
      );
    }

    if (op.state !== 'SETTLED') {
      return NextResponse.json(
        { error: `Cannot submit feedback: operation is in state ${op.state}, must be SETTLED` },
        { status: 400 }
      );
    }

    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

    // Verify challenge signed strictly by mission owner (rejects agent spend tokens)
    const { state } = await prisma.$transaction(async (tx) => {
      return await verifyAndConsumeChallenge(tx, {
        nonce,
        signature,
        action: 'SUBMIT_FEEDBACK',
        payload,
        expectedSigner: mission.ownerAddress,
        targetMissionSlug: mission.slug,
        targetMissionId: mission.missionId,
        appOrigin,
      });
    });

    // FB-01: seller agentId is strictly looked up from tool configuration/env, NOT from client body
    const sellerAgentId = getErc8004AgentIdForTool(op.toolId);

    const feedbackResult = await submitErc8004Feedback({
      agentId: sellerAgentId,
      operationId,
      operationState: op.state,
      ownerConfirmed: true,
      score,
      tag1,
      tag2,
      txHash,
    });

    const isLive = state.paymentMode === 'LIVE_FUJI';

    if (isLive) {
      if (!txHash) {
        // LIVE mode without txHash: return unsigned tx calldata for owner to submit via MetaMask
        return NextResponse.json({
          success: false,
          mode: 'LIVE_FUJI',
          status: 'PENDING_ONCHAIN_FEEDBACK',
          agentId: sellerAgentId.toString(),
          unsignedTx: {
            to: ERC8004_FUJI_REPUTATION_REGISTRY,
            data: feedbackResult.calldata,
            value: '0',
            chainId: 43113,
          },
          txHash: null,
        });
      }

      // Verify on-chain receipt on Fuji
      const verification = await verifyFeedbackReceiptOnFuji({
        txHash,
        expectedAgentId: sellerAgentId,
        registryAddress: ERC8004_FUJI_REPUTATION_REGISTRY,
      });

      if (!verification.valid) {
        return NextResponse.json(
          { error: `On-chain feedback verification failed: ${verification.error}` },
          { status: 400 }
        );
      }

      // ONLY write audit entry once receipt is verified
      await withLockOrder(
        async (tx) => {
          await appendAuditEntry(tx, {
            actor: mission.ownerAddress,
            amount: '0',
            chain_id: op.chainId.toString(),
            kind: 'ERC8004_FEEDBACK',
            mission_id: op.missionSlug,
            operation_id: op.operationId,
            policy_hash: op.policyHash,
            policy_version: '1',
            reason: `Owner feedback submitted: score=${score}, tag=${tag1}`,
            result_hash: '',
            rule: 'ERC8004_FEEDBACK_SUBMITTED',
            source_key: sourceKey,
            to: ERC8004_FUJI_REPUTATION_REGISTRY,
            tx_hash: txHash,
          });
        },
        { missionSlug: op.missionSlug, lockAuditHead: true }
      );

      return NextResponse.json({
        success: true,
        mode: 'LIVE_FUJI',
        status: 'CONFIRMED',
        agentId: sellerAgentId.toString(),
        txHash,
      });
    }

    // MOCK mode: Do not write false on-chain events to audit ledger
    return NextResponse.json({
      success: true,
      mode: 'MOCK',
      status: 'FEEDBACK_MOCK_NOT_SENT',
      agentId: sellerAgentId.toString(),
      txHash: null,
      unsignedTx: {
        to: ERC8004_FUJI_REPUTATION_REGISTRY,
        data: feedbackResult.calldata,
        value: '0',
        chainId: 43113,
      },
    });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    // FB-01: Generic error on 500, never leak internal err.message
    console.error('[Feedback] Internal error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
