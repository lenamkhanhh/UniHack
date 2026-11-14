import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { verifyToken, computePayloadHash } from '@/lib/auth';
import { toolCatalog } from '@/lib/tools';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
  executeUpstreamAndSettle,
} from '@/lib/payments';
import { toOperationDto } from '@/lib/dto';
import { validateLiveFujiConfig, getPaymentMode } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    // KEY-02b: Validate Live Fuji configuration on tools orchestrate route
    if (getPaymentMode() === 'LIVE_FUJI') {
      await validateLiveFujiConfig();
    }
    const systemState = await prisma.systemState.findUnique({ where: { id: 1 } });
    if (systemState?.systemPaused || systemState?.maintenance) {
      return NextResponse.json(
        { error: 'System is paused or in maintenance' },
        { status: 403 }
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return NextResponse.json({ error: 'Missing spend token' }, { status: 401 });
    }

    let claims: any;
    try {
      claims = await verifyToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired spend token' }, { status: 401 });
    }

    if (claims.type !== 'spend') {
      return NextResponse.json({ error: 'Spend token required' }, { status: 403 });
    }

    const body = await req.json();
    const rawId = body.toolId || body.id || 'tool:search';
    const toolId = toolCatalog[rawId] ? rawId : (toolCatalog[`tool:${rawId}`] ? `tool:${rawId}` : rawId);

    if (!toolCatalog[toolId]) {
      return NextResponse.json({ error: `Tool '${rawId}' not found in catalog` }, { status: 404 });
    }

    if (toolId === 'tool:talkmeter') {
      return NextResponse.json(
        { error: 'TalkMeter operations must be initiated via TalkMeter tick service' },
        { status: 403 }
      );
    }

    const operationId = body.operationId || req.headers.get('x-operation-id') || randomUUID();
    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';
    const sellerAddress = process.env.SELLER_ADDRESS || '0x0000000000000000000000000000000000000002';
    const toolArgs = body.arguments || body.input || body;

    const toolDef = toolCatalog[toolId];
    const argCheck = toolDef.validateInput(toolArgs);
    if (!argCheck.valid) {
      return NextResponse.json({ error: argCheck.error }, { status: 400 });
    }

    // Idempotency check: if operation already exists, verify scope and return existing (V4-06)
    const existing = await prisma.toolOperation.findUnique({
      where: { operationId },
    });

    if (existing) {
      if (existing.missionSlug !== claims.missionSlug) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (existing.toolId !== toolId) {
        return NextResponse.json(
          { error: 'OPERATION_SCOPE_MISMATCH: tool mismatch for existing operation' },
          { status: 409 }
        );
      }
      const computedHash = computePayloadHash(argCheck.canonicalInput);
      if (computedHash !== existing.inputHash) {
        return NextResponse.json(
          { error: 'INPUT_MISMATCH: Input parameters differ from existing operation' },
          { status: 409 }
        );
      }

      // If already settled, return settled immediately (immutable terminal outcome)
      if (existing.state === 'SETTLED') {
        return NextResponse.json(
          {
            operationId,
            state: 'SETTLED',
            result: existing.heldResult ? JSON.parse(existing.heldResult) : null,
            operation: toOperationDto(existing, { includeResult: true }),
            mode: existing.paymentMode,
          },
          { status: 200 }
        );
      }

      // If already in terminal FAILED state, return terminal DTO with domain error (M5-01)
      if (existing.state === 'FAILED') {
        return NextResponse.json(
          {
            operationId,
            state: 'FAILED',
            result: null,
            operation: toOperationDto(existing, { includeResult: false }),
            mode: existing.paymentMode,
            failureReason: existing.failureReason || 'OPERATION_FAILED',
            error: existing.failureReason || 'Operation previously failed',
          },
          { status: 400 }
        );
      }
    } else {
      // 1. Quote
      await createQuote({
        operationId,
        toolId,
        input: argCheck.canonicalInput,
        tokenClaims: claims,
        sellerAddress,
        appOrigin,
      });
    }

    // Advance state machine idempotently based on current durable state (M5-01)
    let opState = existing ? existing.state : 'CREATED';

    if (opState === 'CREATED') {
      await reserveOperation({
        operationId,
        tokenClaims: claims,
      });
      opState = 'RESERVED';
    }

    if (opState === 'RESERVED') {
      await signOperationAuthorization({
        operationId,
        agentPrivateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined,
        tokenClaims: claims,
      });
      opState = 'SIGNED';
    }

    // 4. Upstream & Settle (for SIGNED, SUBMITTING, SETTLING, UNKNOWN)
    const execution = await executeUpstreamAndSettle({
      operationId,
      claims,
      toolId,
      arguments: argCheck.canonicalInput,
    });

    const isSettled = execution.operation?.state === 'SETTLED';

    return NextResponse.json(
      {
        operationId,
        state: execution.operation?.state,
        result: isSettled ? execution.result : null,
        operation: toOperationDto(execution.operation, { includeResult: true }),
        mode: execution.mode,
        failureReason: execution.operation?.failureReason,
      },
      { status: isSettled ? 200 : 202 }
    );
  } catch (err: any) {
    if (
      err.message === 'INSUFFICIENT_MISSION_TOOL_BUDGET' ||
      err.message === 'INSUFFICIENT_SESSION_BUDGET' ||
      err.message === 'QUOTE_EXPIRED' ||
      err.message === 'RESERVATION_EXPIRED'
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (
      err.message === 'SYSTEM_PAUSED' ||
      err.message === 'AUTH_VERSION_MISMATCH' ||
      err.message === 'MISSION_NOT_ACTIVE_OR_EXPIRED' ||
      err.message === 'SESSION_WALLET_NOT_FUNDED_ON_CHAIN'
    ) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (
      err.message === 'OPERATION_SCOPE_MISMATCH' ||
      err.message === 'INPUT_MISMATCH' ||
      err.message?.startsWith('OPERATION_SCOPE_MISMATCH') ||
      err.message?.startsWith('INPUT_MISMATCH')
    ) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
