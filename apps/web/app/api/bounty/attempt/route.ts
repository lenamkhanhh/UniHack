import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { PrismaClient } from '@prisma/client';
import {
  processBountyAttempt,
  getLiveTreasuryBalance,
  BountyVector,
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

    // Extract IP safely
    const forwarded = req.headers.get('x-forwarded-for');
    const clientIp = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';

    const result = await processBountyAttempt(
      payload,
      attackerAddress,
      vector as BountyVector,
      clientIp
    );

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error: any) {
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
    const [treasuryBalanceUsdc, totalAttempts, trickedCount, recentAttempts] = await Promise.all([
      getLiveTreasuryBalance(),
      prisma.bountyAttempt.count(),
      prisma.bountyAttempt.count({ where: { llmTricked: true } }),
      prisma.bountyAttempt.findMany({
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
          status: true,
        },
      }),
    ]);

    const trickedRate = totalAttempts > 0 ? ((trickedCount / totalAttempts) * 100).toFixed(1) : '0.0';

    return NextResponse.json({
      success: true,
      stats: {
        treasuryBalanceUsdc,
        totalAttempts,
        trickedCount,
        trickedRate: `${trickedRate}%`,
        blockedCount: totalAttempts, // All unauthorized attempts are blocked
        leakCount: 0,
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
