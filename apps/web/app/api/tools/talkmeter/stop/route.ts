import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { toSessionDto } from '@/lib/dto';
import { normalizeAddress } from '@/lib/chain';

export async function POST(req: NextRequest) {
  try {
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

    const body = await req.json();
    const { sessionId } = body;
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const session = await prisma.toolSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Scoped check (Finding F8)
    if (session.missionSlug !== claims.missionSlug) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (normalizeAddress(session.payerAddress) !== normalizeAddress(claims.agent)) {
      return NextResponse.json({ error: 'Caller agent is not authorized payer for this session' }, { status: 403 });
    }

    const updated = await prisma.toolSession.update({
      where: { id: sessionId },
      data: {
        status: 'STOPPED',
        stoppedAt: new Date(),
      },
    });

    return NextResponse.json({ session: toSessionDto(updated) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
