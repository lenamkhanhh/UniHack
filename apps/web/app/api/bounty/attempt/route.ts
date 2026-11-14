import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { PrismaClient } from '@prisma/client';
import {
  processBountyAttempt,
  getBountyMissionOnchainStats,
  LlmUnavailableError,
  BountyVector,
  resolveClientIp,
  reserveBountyQuota,
  hashIp,
  QuotaExceededError,
  DatabaseUnavailableError,
} from '@/lib/bounty';

const prisma = new PrismaClient();

const VALID_VECTORS: BountyVector[] = [
  'search_result',
  'invoice_pdf_text',
  'vendor_page',
  'email',
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { success: false, error: 'Thiếu dữ liệu body JSON' },
        { status: 400 }
      );
    }

    const { payload, attackerAddress, vector } = body;

    // Server-controlled trust boundary for source classification:
    // Only a trusted internal test harness presenting the valid secret key may classify as test or smoke.
    // Public callers cannot self-classify as 'test' to omit unfavorable attempts from statistics.
    const requestedSource = req.headers.get('x-bounty-source') || body?.source;
    let source: 'public' | 'smoke' | 'test' = 'public';

    if (requestedSource === 'test' || requestedSource === 'smoke') {
      const internalKey = process.env.BOUNTY_INTERNAL_SECRET;
      const providedKey = req.headers.get('x-bounty-auth-key') || req.headers.get('authorization')?.replace('Bearer ', '');
      if (internalKey && providedKey && internalKey.trim().length >= 16 && providedKey === internalKey) {
        source = requestedSource;
      } else {
        source = 'public';
      }
    }

    // Validate payload
    if (!payload || typeof payload !== 'string' || payload.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Payload không được để trống' },
        { status: 400 }
      );
    }

    if (payload.length > 2000) {
      return NextResponse.json(
        { success: false, error: 'Payload vượt quá giới hạn tối đa 2000 ký tự' },
        { status: 400 }
      );
    }

    // Validate attacker address
    if (!attackerAddress || typeof attackerAddress !== 'string' || !isAddress(attackerAddress)) {
      return NextResponse.json(
        { success: false, error: 'Địa chỉ ví attacker không hợp lệ (phải là địa chỉ EVM 40-hex)' },
        { status: 400 }
      );
    }

    // Validate vector
    if (!vector || !VALID_VECTORS.includes(vector as BountyVector)) {
      return NextResponse.json(
        { success: false, error: `Vector không hợp lệ. Chọn 1 trong: ${VALID_VECTORS.join(', ')}` },
        { status: 400 }
      );
    }

    // Extract client IP through trust boundary (Cloudflare / reverse proxy headers)
    const { clientIp } = resolveClientIp(req.headers);

    // Atomically reserve quota in shared DB BEFORE calling expensive LLM or RPC
    const ipHash = hashIp(clientIp);
    const reservation = await reserveBountyQuota(ipHash, source);
    if (!reservation.allowed) {
      return NextResponse.json(
        { success: false, error: reservation.reason || 'Quá giới hạn số lượt thử' },
        { status: 429 }
      );
    }

    const result = await processBountyAttempt(
      payload,
      attackerAddress,
      vector as BountyVector,
      clientIp,
      { source, reservationId: reservation.reservationId || undefined }
    );

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
    if (error instanceof DatabaseUnavailableError || error?.code === 'DB_UNAVAILABLE') {
      return NextResponse.json(
        { success: false, error: error.message || 'Cơ sở dữ liệu tạm thời không khả dụng' },
        { status: 503 }
      );
    }

    if (error instanceof QuotaExceededError || error?.code === 'QUOTA_EXCEEDED') {
      return NextResponse.json({ success: false, error: error.message }, { status: 429 });
    }

    if (
      error instanceof LlmUnavailableError ||
      error?.code === 'LLM_UNAVAILABLE' ||
      error?.message?.includes('LLM_UNAVAILABLE') ||
      error?.message?.includes('Gemini LLM unavailable')
    ) {
      return NextResponse.json(
        {
          success: false,
          status: 'LLM_UNAVAILABLE',
          error: 'Agent tạm thời không phản hồi, thử lại',
        },
        { status: 503 }
      );
    }

    const msg = error?.message || 'Lỗi xử lý bounty attempt';
    if (msg.includes('Quá giới hạn')) {
      return NextResponse.json({ success: false, error: msg }, { status: 429 });
    }
    console.error('Bounty API Error:', error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const onchainStats = await getBountyMissionOnchainStats();
    const publicFilter = { mode: 'llm', source: 'public' };

    const [
      totalAttempts,
      trickedCount,
      confirmedBlockCount,
      queuedCount,
      rpcErrorCount,
      noPayoutCount,
      bypassCount,
      recentAttempts,
    ] = await Promise.all([
      prisma.bountyAttempt.count({ where: publicFilter }),
      prisma.bountyAttempt.count({ where: { ...publicFilter, llmTricked: true } }),
      prisma.bountyAttempt.count({ where: { ...publicFilter, status: 'BLOCKED' } }),
      prisma.bountyAttempt.count({ where: { ...publicFilter, status: 'OFFCHAIN_QUEUED' } }),
      prisma.bountyAttempt.count({ where: { ...publicFilter, status: 'RPC_ERROR' } }),
      prisma.bountyAttempt.count({ where: { ...publicFilter, status: 'NO_PAYOUT_PROPOSED' } }),
      prisma.bountyAttempt.count({ where: { ...publicFilter, status: 'POTENTIAL_BYPASS' } }),
      prisma.bountyAttempt.findMany({
        where: publicFilter,
        take: 10,
        orderBy: { timestamp: 'desc' },
        select: {
          id: true,
          timestamp: true,
          vector: true,
          payloadPreview: true,
          attackerAddress: true,
          llmTricked: true,
          offchainRule: true,
          onchainResult: true,
          model: true,
          mode: true,
          source: true,
          status: true,
        },
      }),
    ]);

    const trickedRate = totalAttempts > 0 ? ((trickedCount / totalAttempts) * 100).toFixed(1) : '0.0';

    return NextResponse.json({
      success: true,
      stats: {
        treasuryBalanceUsdc: onchainStats.treasuryBalanceUsdc,
        bountyCapUsdc: onchainStats.bountyCapUsdc,
        bountySpentUsdc: onchainStats.bountySpentUsdc,
        bountyRemainingUsdc: onchainStats.bountyRemainingUsdc,
        totalAttempts,
        trickedCount,
        trickedRate: `${trickedRate}%`,
        blockedCount: confirmedBlockCount,
        queuedCount,
        rpcErrorCount,
        noPayoutCount,
        leakCount: bypassCount,
        simulationNotice: 'Verification is performed via on-chain eth_call contract simulation on Avalanche Fuji testnet; not an actual funds transfer.',
        recentAttempts,
      },
    });
  } catch (error: any) {
    console.error('Bounty GET Error:', error);
    return NextResponse.json(
      { success: false, error: 'Không thể tải thống kê bounty' },
      { status: 500 }
    );
  }
}
