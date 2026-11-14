import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { reserveOperation, signOperationAuthorization } from '@/lib/payments';

export async function POST(
  req: NextRequest,
  context: any
) {
  try {
    const { id: operationId } = await context.params;
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return NextResponse.json({ error: 'Missing spend token' }, { status: 401 });
    }

    let claims;
    try {
      claims = await verifyToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired spend token' }, { status: 401 });
    }

    if (claims.type !== 'spend') {
      return NextResponse.json({ error: 'Spend token required' }, { status: 403 });
    }

    // 1. Reserve budget
    const reserved = await reserveOperation({
      operationId,
      tokenClaims: claims,
    });

    // 2. Sign authorization
    const signed = await signOperationAuthorization({
      operationId,
      agentPrivateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined,
    });

    return NextResponse.json({
      operationId,
      state: signed.state,
      reservedAmount: signed.reservedAmount.toString(),
      authFrom: signed.authFrom,
      authTo: signed.authTo,
      authNonce: signed.authNonce,
      validAfter: signed.validAfter?.toString(),
      validBefore: signed.validBefore?.toString(),
    });
  } catch (err: any) {
    if (err.message === 'INSUFFICIENT_MISSION_TOOL_BUDGET' || err.message === 'INSUFFICIENT_SESSION_BUDGET') {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
