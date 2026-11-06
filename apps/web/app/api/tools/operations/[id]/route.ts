import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { reconcileOperation } from '@/lib/reconcile';
import { toOperationDto } from '@/lib/dto';

export async function GET(
  req: NextRequest,
  context: any
) {
  try {
    const { id: operationId } = await context.params;
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

    // 1. Scoped lookup BEFORE reconcile to avoid mutating operations from other scopes (Finding F2)
    const existing = await prisma.toolOperation.findUnique({
      where: { operationId },
    });

    if (!existing || existing.missionSlug !== claims.missionSlug) {
      // Uniform 404 to avoid leaking existence of cross-mission operations
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // 2. Lazy reconcile on GET (02 §5, §6)
    const reconciled = await reconcileOperation(operationId);
    if (!reconciled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Result is ONLY returned when state is SETTLED (02 §4, §6, 05 §4)
    return NextResponse.json(toOperationDto(reconciled, { includeResult: true }));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
