import { NextResponse } from 'next/server';
import { fetchLiveReceipts, getTwinLiveEvidence } from '@/lib/judge-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const receipts = await fetchLiveReceipts();
    return NextResponse.json({
      success: true,
      chain: 'avalanche-fuji',
      chainId: 43113,
      treasuryAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
      evidenceSource: 'evidence/twin/twin.live.json',
      receipts,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to fetch transaction receipts from Avalanche Fuji',
      },
      { status: 500 }
    );
  }
}
