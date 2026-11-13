import { NextRequest, NextResponse } from 'next/server';
import { resolveClientIp } from '@/lib/bounty';
import {
  checkSimulateRateLimit,
  runJudgeSimulation,
  GUARDED_TREASURY_ADDRESS,
  AGENT_ADDRESS,
} from '@/lib/judge-service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { clientIp } = resolveClientIp(req.headers);
  if (!checkSimulateRateLimit(clientIp, 10)) {
    return NextResponse.json(
      {
        success: false,
        error: 'QUOTA_EXCEEDED',
        message: 'Rate limit exceeded: max 10 simulations per minute per IP.',
        messageVi: 'Vượt quá giới hạn: tối đa 10 lượt mô phỏng mỗi phút theo địa chỉ IP.',
      },
      { status: 429 }
    );
  }

  let body: any;
  try {
    const rawText = await req.text();
    if (rawText.length > 2048) {
      return NextResponse.json(
        {
          success: false,
          error: 'BAD_REQUEST',
          message: 'Request body exceeds 2KB size limit.',
        },
        { status: 400 }
      );
    }
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'BAD_REQUEST',
        message: 'Invalid JSON body.',
      },
      { status: 400 }
    );
  }

  const { recipient, amountAtomic = 10000, reason = '' } = body || {};

  if (!recipient || typeof recipient !== 'string') {
    return NextResponse.json(
      {
        success: false,
        error: 'BAD_REQUEST',
        message: 'Recipient address string is required.',
      },
      { status: 400 }
    );
  }

  if (typeof amountAtomic !== 'number' || amountAtomic <= 0 || amountAtomic > 10000) {
    return NextResponse.json(
      {
        success: false,
        error: 'BAD_REQUEST',
        message: 'Amount out of bounds: must be between 1 and 10000 atomic units ($0.01 USDC max).',
      },
      { status: 400 }
    );
  }

  if (typeof reason === 'string' && reason.length > 256) {
    return NextResponse.json(
      {
        success: false,
        error: 'BAD_REQUEST',
        message: 'Reason parameter must not exceed 256 characters.',
      },
      { status: 400 }
    );
  }

  try {
    const simResult = await runJudgeSimulation(recipient, amountAtomic);
    return NextResponse.json({
      success: true,
      simulation: simResult,
    });
  } catch (err: any) {
    if (err?.message === 'INVALID_ADDRESS') {
      return NextResponse.json(
        {
          success: false,
          error: 'BAD_REQUEST',
          message: 'Invalid Ethereum address: must be a 20-byte hex address.',
        },
        { status: 400 }
      );
    }

    if (err?.message === 'INVALID_AMOUNT') {
      return NextResponse.json(
        {
          success: false,
          error: 'BAD_REQUEST',
          message: 'Amount out of bounds: must be between 1 and 10000 atomic units ($0.01 USDC max).',
        },
        { status: 400 }
      );
    }

    if (err?.isRpcError || err?.message?.startsWith('RPC_ERROR')) {
      return NextResponse.json(
        {
          success: false,
          error: 'RPC_ERROR',
          message:
            'Avalanche Fuji RPC node error or rate limit. This is not a contract revert.',
          messageVi:
            'Lỗi kết nối RPC node Avalanche Fuji (429/timeout). Đây không phải lỗi từ hợp đồng.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'SIMULATION_ERROR',
        message: err?.message || 'Simulation execution failed.',
      },
      { status: 500 }
    );
  }
}
