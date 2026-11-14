import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db';
import {
  computePayloadHash,
  generateEip191Message,
  ActionType,
} from '@/lib/auth';
import { normalizeAddress } from '@/lib/chain';
import { getConfiguredOwner } from '@/lib/config';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, payload, expectedSigner } = body;

    if (!action || !payload || !expectedSigner) {
      return NextResponse.json(
        { error: 'action, payload, and expectedSigner are required' },
        { status: 400 }
      );
    }

    if (action === 'CREATE_MISSION' || action === 'PAUSE_S1') {
      const configuredOwner = getConfiguredOwner();
      if (normalizeAddress(expectedSigner) !== configuredOwner) {
        return NextResponse.json({ error: 'Signer is not authorized owner' }, { status: 403 });
      }
    }

    // Read system state
    const state = await prisma.systemState.findUnique({ where: { id: 1 } });
    if (!state) {
      return NextResponse.json({ error: 'System uninitialized' }, { status: 500 });
    }

    const payloadHash = computePayloadHash(payload);
    const nonce = `0x${randomBytes(32).toString('hex')}`;
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = new Date((issuedAt + 600) * 1000);

    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

    const message = generateEip191Message({
      action: action as ActionType,
      deploymentId: state.deploymentId,
      appOrigin,
      stage: state.stage as 'S1' | 'S2',
      guardAddress: state.guardAddress,
      authVersion: state.authVersion,
      payloadHash,
      nonce,
      issuedAt,
    });

    await prisma.authChallenge.create({
      data: {
        nonce,
        action,
        payloadHash,
        expectedSigner: normalizeAddress(expectedSigner),
        deploymentId: state.deploymentId,
        authVersion: state.authVersion,
        expiresAt,
      },
    });

    return NextResponse.json({
      nonce,
      action,
      payloadHash,
      message,
      expiresAt: expiresAt.toISOString(),
      issuedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
