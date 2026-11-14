import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { TALKMETER_PRICE_PER_MINUTE, TALKMETER_SESSION_CAP } from '@/lib/constants';
import { toSessionDto } from '@/lib/dto';

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

    const sessionId = randomUUID();
    const session = await prisma.toolSession.create({
      data: {
        id: sessionId,
        missionSlug: claims.missionSlug,
        payerAddress: claims.agent,
        rate: TALKMETER_PRICE_PER_MINUTE.toString(),
        cap: TALKMETER_SESSION_CAP.toString(),
        spent: '0',
        reserved: '0',
        status: 'ACTIVE',
        startedAt: new Date(),
      },
    });

    return NextResponse.json({ session: toSessionDto(session) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
