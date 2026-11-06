import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST(
  req: NextRequest,
  context: any
) {
  try {
    const { id: operationId } = await context.params;
    const body = await req.json();
    const { proposalId, txHash, chainId, guardAddress, state } = body;

    const request = await prisma.treasuryRequest.upsert({
      where: { operationId },
      create: {
        operationId,
        missionSlug: body.missionSlug || 'default',
        requestHash: body.requestHash || '0x',
        state: state || 'CONFIRMED',
        proposalId: proposalId?.toString(),
        rawTxHash: txHash,
        chainId: chainId || 43113,
        guardAddress: guardAddress || '',
      },
      update: {
        state: state || 'CONFIRMED',
        proposalId: proposalId?.toString(),
        rawTxHash: txHash,
      },
    });

    return NextResponse.json({
      request: {
        operationId: request.operationId,
        missionSlug: request.missionSlug,
        requestHash: request.requestHash,
        state: request.state,
        proposalId: request.proposalId,
        rawTxHash: request.rawTxHash,
        agentNonce: request.agentNonce?.toString() ?? null,
        chainId: request.chainId,
        guardAddress: request.guardAddress,
        createdAt: request.createdAt.toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
