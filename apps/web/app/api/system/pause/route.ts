import { NextRequest, NextResponse } from 'next/server';
import { withLockOrder } from '@/lib/db';
import { appendAuditEntry } from '@/lib/audit';
import { getConfiguredOwner } from '@/lib/config';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nonce, signature, payload } = body;

    if (!nonce || !signature || !payload) {
      return NextResponse.json(
        { error: 'nonce, signature, and payload are required' },
        { status: 400 }
      );
    }

    const { desiredPaused } = payload;
    if (typeof desiredPaused !== 'boolean') {
      return NextResponse.json({ error: 'desiredPaused boolean required' }, { status: 400 });
    }

    const configuredOwner = getConfiguredOwner();
    const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';

    // Atomically consume challenge, update system state, and audit
    await withLockOrder(
      async (tx) => {
        await verifyAndConsumeChallenge(tx, {
          nonce,
          signature,
          action: 'PAUSE_S1',
          payload,
          expectedSigner: configuredOwner,
          appOrigin,
        });

        await tx.systemState.update({
          where: { id: 1 },
          data: { systemPaused: desiredPaused },
        });

        await appendAuditEntry(tx, {
          actor: configuredOwner,
          amount: '0',
          chain_id: '43113',
          kind: desiredPaused ? 'PAUSED' : 'UNPAUSED',
          mission_id: '',
          operation_id: '',
          policy_hash: '',
          policy_version: '1',
          reason: desiredPaused ? 'Owner paused system' : 'Owner unpaused system',
          result_hash: '',
          rule: 'PAUSE_S1',
          source_key: `pause:${nonce}`,
          to: '',
          tx_hash: '',
        });
      },
      { lockAuditHead: true }
    );

    return NextResponse.json({ success: true, systemPaused: desiredPaused });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
