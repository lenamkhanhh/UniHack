import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
  executeUpstreamAndSettle,
} from '@/lib/payments';
import { toOperationDto } from '@/lib/dto';
import { normalizeAddress } from '@/lib/chain';
import { TALKMETER_PRICE_PER_MINUTE, TALKMETER_SESSION_CAP } from '@/lib/constants';

export async function POST(req: NextRequest) {
  let sessionId: string | undefined;
  let claims: any = null;
  let nextMinuteIndex: number | undefined;

  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return NextResponse.json({ error: 'Missing spend token' }, { status: 401 });
    }

    try {
      claims = await verifyToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired spend token' }, { status: 401 });
    }

    // Spend token required (Finding F8)
    if (claims.type !== 'spend') {
      return NextResponse.json({ error: 'Spend token required for TalkMeter billing' }, { status: 403 });
    }

    const body = await req.json();
    sessionId = body.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const now = new Date();

    // Lock session under mission lock to select minute and check bounds atomically (Finding F8, F9)
    const sessionCheck = await withLockOrder(
      async (tx) => {
        const session = await tx.toolSession.findUnique({
          where: { id: sessionId },
          include: {
            operations: {
              orderBy: { minuteIndex: 'asc' },
            },
          },
        });

        if (!session) {
          return { error: 'Session not found', status: 404 };
        }

        // Scope validation: session must belong to caller mission and payer (Finding F8)
        if (session.missionSlug !== claims.missionSlug) {
          return { error: 'Session not found', status: 404 };
        }

        if (normalizeAddress(session.payerAddress) !== normalizeAddress(claims.agent)) {
          return { error: 'Caller agent is not authorized payer for this session', status: 403 };
        }

        if (session.status !== 'ACTIVE') {
          return { error: `Session is ${session.status}`, status: 400 };
        }

        const completedMinutes = Math.floor(
          (now.getTime() - session.startedAt.getTime()) / 60000
        );

        if (completedMinutes <= 0) {
          return {
            error: 'No minute completed yet (requires at least 60 seconds elapsed)',
            status: 400,
          };
        }

        // Server selects smallest uncreated index
        const existingOpsByMinute = new Map<number, any>();
        for (const op of session.operations) {
          if (op.minuteIndex !== null) {
            existingOpsByMinute.set(op.minuteIndex, op);
          }
        }

        let nextMinuteIndex = -1;
        for (let i = 0; i < completedMinutes; i++) {
          if (!existingOpsByMinute.has(i)) {
            nextMinuteIndex = i;
            break;
          }
        }

        if (nextMinuteIndex === -1) {
          // All completed minutes already billed - return existing latest operation
          const lastOp = session.operations[session.operations.length - 1];
          return {
            alreadyBilled: true,
            operation: lastOp,
          };
        }

        // Check session cap (2 USDC)
        const currentExposure =
          BigInt(session.spent.toString()) + BigInt(session.reserved.toString());
        if (currentExposure + TALKMETER_PRICE_PER_MINUTE > TALKMETER_SESSION_CAP) {
          await tx.toolSession.update({
            where: { id: sessionId },
            data: { status: 'CAPPED' },
          });
          return { error: 'Session reached cap of 2 USDC', status: 400 };
        }

        return { nextMinuteIndex, session };
      },
      { sessionId }
    );

    if ('error' in sessionCheck && sessionCheck.error) {
      return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
    }

    if ('alreadyBilled' in sessionCheck && sessionCheck.alreadyBilled) {
      return NextResponse.json({
        message: 'Current completed minutes already billed',
        operation: toOperationDto(sessionCheck.operation, { includeResult: true }),
      });
    }

    nextMinuteIndex = (sessionCheck as { nextMinuteIndex: number }).nextMinuteIndex;
    const operationId = randomUUID();
    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';
    const sellerAddress = process.env.SELLER_ADDRESS || '0x0000000000000000000000000000000000000002';

    // 1. Create quote
    await createQuote({
      operationId,
      toolId: 'tool:talkmeter',
      input: { minuteIndex: nextMinuteIndex },
      tokenClaims: claims,
      sellerAddress,
      appOrigin,
      sessionId,
      minuteIndex: nextMinuteIndex,
    });

    // 2. Reserve
    await reserveOperation({
      operationId,
      tokenClaims: claims,
    });

    // 3. Sign
    await signOperationAuthorization({
      operationId,
      agentPrivateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined,
    });

    // 4. Execute & Settle
    const settlement = await executeUpstreamAndSettle({
      operationId,
      claims,
      toolId: 'tool:talkmeter',
      arguments: { minuteIndex: nextMinuteIndex },
    });

    return NextResponse.json({
      minuteIndex: nextMinuteIndex,
      operation: toOperationDto(settlement.operation, { includeResult: true }),
      result: settlement.result,
    });
  } catch (err: any) {
    if (err.code === 'P2002' && sessionId && nextMinuteIndex !== undefined && claims?.missionSlug) {
      // Unique constraint conflict (concurrent tick for same minute): query and return existing operation
      const existing = await prisma.toolOperation.findFirst({
        where: {
          sessionId,
          minuteIndex: nextMinuteIndex,
          missionSlug: claims.missionSlug,
        },
      });
      if (existing) {
        const isSettled = existing.state === 'SETTLED';
        return NextResponse.json({
          minuteIndex: nextMinuteIndex,
          operation: toOperationDto(existing, { includeResult: isSettled }),
          result: isSettled && existing.heldResult ? JSON.parse(existing.heldResult) : null,
        });
      }
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
