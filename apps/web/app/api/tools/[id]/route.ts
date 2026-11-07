import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyToken, computePayloadHash } from '@/lib/auth';
import {
  createQuote,
  reserveOperation,
  signOperationAuthorization,
  executeUpstreamAndSettle,
} from '@/lib/payments';
import { toolCatalog } from '@/lib/tools';
import { toOperationDto } from '@/lib/dto';
import { X402_HEADER, X402_RESPONSE_HEADER, X402_VERSION, X402_SCHEME } from '@/lib/constants';
import { normalizeAddress } from '@/lib/chain';
import { computeBoundNonce } from '@/lib/x402-binding';

export async function POST(
  req: NextRequest,
  context: any
) {
  try {
    const { id } = await context.params;
    const rawId = decodeURIComponent(id);
    const toolId = toolCatalog[rawId] ? rawId : (toolCatalog[`tool:${rawId}`] ? `tool:${rawId}` : rawId);
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
    const operationId = req.headers.get('x-operation-id') || body.operationId;
    if (!operationId) {
      return NextResponse.json({ error: 'operationId is required' }, { status: 400 });
    }

    // Generic tools route cannot create or drive TalkMeter sessions/minutes (Finding F8)
    if (toolId === 'tool:talkmeter' || body.sessionId || body.minuteIndex !== undefined) {
      return NextResponse.json(
        { error: 'TalkMeter operations must be initiated via TalkMeter tick service' },
        { status: 403 }
      );
    }

    const xPaymentHeader = req.headers.get(X402_HEADER.toLowerCase()) || req.headers.get(X402_HEADER);
    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';
    const sellerAddress = process.env.SELLER_ADDRESS || '0x0000000000000000000000000000000000000002';

    // 1. Unpaid request or server-orchestrated request
    if (!xPaymentHeader) {
      if (req.headers.get('x-orchestrate') === 'true' || body.orchestrate === true) {
        await createQuote({
          operationId,
          toolId,
          input: body.arguments || body.input || body,
          tokenClaims: claims,
          sellerAddress,
          appOrigin,
        });

        await reserveOperation({
          operationId,
          tokenClaims: claims,
        });

        await signOperationAuthorization({
          operationId,
          agentPrivateKey: process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined,
        });

        const execution = await executeUpstreamAndSettle({
          operationId,
          claims,
          toolId,
          arguments: body.arguments || body.input || body,
        });

        const isSettled = execution.operation?.state === 'SETTLED';
        return NextResponse.json({
          operationId,
          state: execution.operation?.state,
          result: isSettled ? execution.result : null,
          operation: toOperationDto(execution.operation, { includeResult: true }),
          mode: execution.mode,
          failureReason: execution.operation?.failureReason,
        });
      }

      const quote = await createQuote({
        operationId,
        toolId,
        input: body.arguments || body.input || body,
        tokenClaims: claims,
        sellerAddress,
        appOrigin,
      });

      return NextResponse.json(quote.unpaidResponse, {
        status: 402,
        headers: {
          'X-Operation-Id': operationId,
        },
      });
    }

    // 2. Paid request: Decode and strictly verify x402 payment payload (Finding F2)
    let paymentPayload: any;
    try {
      const rawJson = Buffer.from(xPaymentHeader, 'base64').toString('utf8');
      paymentPayload = JSON.parse(rawJson);
    } catch {
      return NextResponse.json({ error: 'Malformed X-PAYMENT header (must be valid base64 JSON)' }, { status: 400 });
    }

    if (
      paymentPayload.x402Version !== X402_VERSION ||
      paymentPayload.scheme !== X402_SCHEME ||
      paymentPayload.network !== 'avalanche-fuji' ||
      !paymentPayload.payload ||
      !paymentPayload.payload.authorization ||
      !paymentPayload.payload.signature
    ) {
      return NextResponse.json(
        { error: 'Invalid X-PAYMENT protocol envelope or unsupported scheme/version/network' },
        { status: 400 }
      );
    }

    const auth = paymentPayload.payload.authorization;

    // Scoped lookup before execution
    const op = await prisma.toolOperation.findUnique({
      where: { operationId },
    });

    if (!op || op.missionSlug !== claims.missionSlug) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // ATC'26 F4: Premature result disclosure gating on terminal failed state
    if (op.state === 'FAILED') {
      return NextResponse.json(
        {
          operationId,
          state: 'FAILED',
          result: null,
          failureReason: op.failureReason,
          error: op.failureReason || 'OPERATION_FAILED',
        },
        { status: 400 }
      );
    }

    // Validate tool existence
    const tool = toolCatalog[toolId];
    if (!tool) {
      return NextResponse.json({ error: `Tool ${toolId} not found` }, { status: 404 });
    }

    // Compute input hash from incoming request body
    const argCheck = tool.validateInput(body.arguments || body.input || body);
    if (!argCheck.valid) {
      return NextResponse.json({ error: argCheck.error || 'Invalid arguments' }, { status: 400 });
    }
    const incomingInputHash = computePayloadHash(argCheck.canonicalInput);

    const terms = JSON.parse(op.paymentTerms || '{}');

    // Cryptographic request-bound nonce check (ATC'26 F1 Defense)
    const expectedBoundNonce = computeBoundNonce({
      operationId: op.operationId,
      toolId,
      inputHash: incomingInputHash,
      priceAtomic: terms.priceAtomic || op.authValue || '0',
      payTo: terms.payTo || op.authTo || '',
      chainId: op.chainId,
    });

    const authNonce = (auth.nonce || '').toLowerCase();
    if (
      authNonce !== expectedBoundNonce.toLowerCase() ||
      (op.authNonce || '').toLowerCase() !== expectedBoundNonce.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error: 'PAYMENT_NOT_BOUND_TO_REQUEST',
          expectedNonce: expectedBoundNonce,
          receivedNonce: auth.nonce,
        },
        { status: 403 }
      );
    }

    if (op.toolId !== toolId) {
      return NextResponse.json(
        { error: 'PAYMENT_NOT_BOUND_TO_REQUEST', detail: 'Tool mismatch' },
        { status: 403 }
      );
    }

    // Bind payment authorization to stored immutable operation authorization
    if (
      normalizeAddress(auth.from) !== normalizeAddress(op.authFrom || '') ||
      normalizeAddress(auth.to) !== normalizeAddress(op.authTo || '') ||
      auth.value?.toString() !== op.authValue?.toString() ||
      paymentPayload.payload.signature !== op.authSignature
    ) {
      return NextResponse.json(
        { error: 'X-PAYMENT authorization does not match operation terms' },
        { status: 403 }
      );
    }

    // Execute upstream and settle with caller claims binding
    const execution = await executeUpstreamAndSettle({
      operationId,
      claims,
      toolId,
      arguments: body.arguments || body.input || body,
    });

    const isSettled = execution.operation?.state === 'SETTLED';

    const paymentResponseHeader = Buffer.from(
      JSON.stringify({
        x402Version: X402_VERSION,
        txHash: execution.operation?.txHash || (isSettled ? 'mock:settled' : null),
        status: execution.operation?.state,
      })
    ).toString('base64');

    // Result is ONLY returned when state is SETTLED (Finding F4)
    const returnedResult = isSettled ? execution.result : null;
    const responseStatus = isSettled ? 200 : 202;

    return NextResponse.json(
      {
        operationId,
        state: execution.operation?.state,
        result: returnedResult,
        txHash: execution.operation?.txHash,
        mode: execution.mode,
        failureReason: execution.operation?.failureReason,
      },
      {
        status: responseStatus,
        headers: {
          [X402_RESPONSE_HEADER]: paymentResponseHeader,
          'X-Operation-Id': operationId,
        },
      }
    );
  } catch (err: any) {
    if (err.message === 'OPERATION_SCOPE_MISMATCH' || err.message === 'INPUT_MISMATCH') {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err.message === 'OPERATION_NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
