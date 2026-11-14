import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { toMissionDto, toOperationDto, toSessionDto } from '@/lib/dto';

export async function GET(
  req: NextRequest,
  context: any
) {
  try {
    const { slug } = await context.params;
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let claims;
    try {
      claims = await verifyToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    if (claims.missionSlug !== slug) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const mission = await prisma.mission.findUnique({
      where: { slug },
      include: {
        operations: {
          orderBy: { createdAt: 'asc' },
        },
        sessions: {
          orderBy: { startedAt: 'asc' },
        },
      },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const missionDto = {
      ...toMissionDto(mission),
      operations: mission.operations.map((op) => toOperationDto(op)),
      sessions: mission.sessions.map((s) => toSessionDto(s)),
    };

    return NextResponse.json({ mission: missionDto });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
