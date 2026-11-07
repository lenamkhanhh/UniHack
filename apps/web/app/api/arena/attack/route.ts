import { NextRequest, NextResponse } from 'next/server';
import { sanitizeAttackPrompt, checkArenaRateLimit, processArenaAttack } from '@/lib/arena';

export async function POST(req: NextRequest) {
  try {
    // Trusted IP extraction (WOW-F7): prioritize req.ip, never trust client-spoofed custom headers
    const forwarded = req.headers.get('x-forwarded-for');
    const clientIp = req.ip || (forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1');

    // Rate-limit check: enforces per-client 5 req/min AND global ceiling 60 req/min (WOW-F7)
    const rateCheck = checkArenaRateLimit(clientIp);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: rateCheck.reason || 'Rate limit exceeded.',
          retryAfterSeconds: rateCheck.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSeconds || 60) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawPrompt = body?.prompt;

    const sanitizeRes = sanitizeAttackPrompt(rawPrompt);
    if (!sanitizeRes.valid) {
      return NextResponse.json({ error: sanitizeRes.error || 'Invalid attack prompt' }, { status: 400 });
    }

    const result = processArenaAttack(rawPrompt, clientIp);

    return NextResponse.json({
      success: true,
      record: result.record,
      stats: result.stats,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal arena error' }, { status: 500 });
  }
}
