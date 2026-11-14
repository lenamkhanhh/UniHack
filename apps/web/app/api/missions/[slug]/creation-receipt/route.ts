import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { normalizeAddress } from '@/lib/chain';
import { verifyMessage } from 'viem';
import { reconcileMissionCreationReceipt } from '@/lib/validator-job';

export async function POST(req: NextRequest, context: any) {
  try {
    const { slug } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { txHash } = body;

    if (!txHash || typeof txHash !== 'string') {
      return NextResponse.json({ error: 'txHash is required' }, { status: 400 });
    }

    const mission = await prisma.mission.findUnique({
      where: { slug },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    // Owner authorization
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const signature = req.headers.get('x-owner-signature');
    const signer = req.headers.get('x-owner-signer');
    const message = req.headers.get('x-auth-message');

    let isAuthorized = false;

    if (token) {
      try {
        const claims = await verifyToken(token);
        const ownerLower = mission.ownerAddress.toLowerCase();
        const callerOwnerLower = claims.owner?.toLowerCase();
        const claimsSlug = claims.missionSlug;
        if (callerOwnerLower === ownerLower && (!claimsSlug || claimsSlug === mission.slug)) {
          isAuthorized = true;
        } else {
          return NextResponse.json(
            { error: 'Unauthorized: token owner or mission slug mismatch' },
            { status: 403 }
          );
        }
      } catch (authErr: any) {
        return NextResponse.json(
          { error: `Unauthorized: ${authErr?.message || 'invalid token'}` },
          { status: 401 }
        );
      }
    } else if (signature && signer && message) {
      const normalizedSigner = normalizeAddress(signer);
      const normalizedOwner = normalizeAddress(mission.ownerAddress);
      if (normalizedSigner !== normalizedOwner) {
        return NextResponse.json(
          { error: 'Unauthorized: signer does not match mission owner' },
          { status: 403 }
        );
      }
      if (!message.includes(mission.slug) || !message.includes(txHash)) {
        return NextResponse.json(
          { error: 'Unauthorized: signature message does not bind mission slug and txHash' },
          { status: 400 }
        );
      }
      const isValid = await verifyMessage({
        address: signer as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      if (!isValid) {
        return NextResponse.json(
          { error: 'Unauthorized: invalid owner signature' },
          { status: 401 }
        );
      }
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Authorization required: valid Bearer token or owner signature is required' },
        { status: 401 }
      );
    }

    const result = await reconcileMissionCreationReceipt(slug, txHash);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Creation receipt reconciliation error' }, { status: 500 });
  }
}
