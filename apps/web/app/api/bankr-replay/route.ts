import { NextResponse } from 'next/server';
import { executeBankrReplay } from '@/lib/bankr-replay';

export async function POST() {
  try {
    const result = await executeBankrReplay();
    return NextResponse.json({
      success: true,
      replay: result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal bankr replay error' }, { status: 500 });
  }
}
