import { NextRequest, NextResponse } from 'next/server';
import { getArenaState, resetArenaForTesting } from '@/lib/arena';

export async function GET() {
  const state = getArenaState();
  return NextResponse.json(state);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body?.reset) {
    resetArenaForTesting();
    return NextResponse.json({ success: true, message: 'Arena state reset successfully' });
  }
  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}
