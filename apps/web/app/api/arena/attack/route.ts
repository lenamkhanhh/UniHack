import { NextRequest, NextResponse } from 'next/server';
import { sanitizeAttackPrompt, checkArenaRateLimit, processArenaAttack } from '@/lib/arena';

export async function POST(req: NextRequest) {
  try {
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
    const clientId = req.headers.get('x-arena-client-id') || ip;

    // Rate-limit check
    const rateCheck = checkArenaRateLimit(clientId);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. Please wait ${rateCheck.retryAfterSeconds} seconds before sending another attack.`,
          retryAfterSeconds: rateCheck.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawPrompt = body?.prompt;

    const sanitizeRes = sanitizeAttackPrompt(rawPrompt);
    if (!sanitizeRes.valid) {
      return NextResponse.json({ error: sanitizeRes.error || 'Invalid attack prompt' }, { status: 400 });
    }

    const result = processArenaAttack(rawPrompt, clientId);

    return NextResponse.json({
      success: true,
      record: result.record,
      stats: result.stats,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal arena error' }, { status: 500 });
  }
}
