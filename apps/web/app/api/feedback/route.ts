import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { appendAuditEntry } from '@/lib/audit';
import { submitErc8004Feedback } from '@/lib/erc8004';
import { verifyToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    let claims: any;
    try {
      claims = await verifyToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const body = await req.json();
    const { operationId, score = 87, tag1 = 'starred', tag2 = 'unihack-s2', agentId = 1001 } = body;

    if (!operationId) {
      return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
    }

    const op = await prisma.toolOperation.findUnique({
      where: { operationId },
    });

    if (!op || op.missionSlug !== claims.missionSlug) {
      return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
    }

    if (op.state !== 'SETTLED') {
      return NextResponse.json(
        { error: `Cannot submit feedback: operation is in state ${op.state}, must be SETTLED` },
        { status: 400 }
      );
    }

    const feedbackResult = await submitErc8004Feedback({
      agentId: BigInt(agentId),
      operationId,
      operationState: op.state,
      ownerConfirmed: true,
      score,
      tag1,
      tag2,
    });

    // Record audit entry
    await withLockOrder(
      async (tx) => {
        await appendAuditEntry(tx, {
          actor: claims.ownerAddress || claims.agent || '0xOwner',
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
          source_key: `feedback:${operationId}:${Date.now()}`,
          to: feedbackResult.registryAddress,
          tx_hash: feedbackResult.txHash || '',
        });
      },
      { missionSlug: op.missionSlug, lockAuditHead: true }
    );

    return NextResponse.json(feedbackResult);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
