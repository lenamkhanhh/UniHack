import { NextRequest, NextResponse } from 'next/server';
import { getArenaState, resetArenaForTesting } from '@/lib/arena';

export async function GET() {
  const state = getArenaState();
  return NextResponse.json({
    success: true,
    ...state,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body?.reset) {
    const presenterKey = process.env.ARENA_PRESENTER_KEY || 'unihack-stage-presenter-2026';
    const providedKey = req.headers.get('x-presenter-key') || body?.presenterKey;

    if (!providedKey || providedKey !== presenterKey) {
      return NextResponse.json(
        { error: 'Unauthorized: Presenter key required to reset arena sandbox' },
        { status: 401 }
      );
    }

    resetArenaForTesting();
    return NextResponse.json({ success: true, message: 'Arena state reset successfully' });
  }
  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}
