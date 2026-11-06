import { NextRequest, NextResponse } from 'next/server';
import { prisma, withLockOrder } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import {
  validateProposalSchema,
  validateProposal,
  ValidationContext,
} from '@/lib/validator';
import { appendAuditEntry } from '@/lib/audit';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (!token) {
      return NextResponse.json({ error: 'Missing spend token' }, { status: 401 });
    }

    let claims;
    try {
      claims = await verifyToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired spend token' }, { status: 401 });
    }

    if (claims.type !== 'spend') {
      return NextResponse.json({ error: 'Spend token required' }, { status: 403 });
    }

    const body = await req.json();
    const schemaCheck = validateProposalSchema(body);
    if (!schemaCheck.valid || !schemaCheck.proposal) {
      return NextResponse.json({ error: schemaCheck.error }, { status: 400 });
    }

    const proposal = schemaCheck.proposal;

    // Load mission and system state
    const mission = await prisma.mission.findUnique({
      where: { slug: claims.missionSlug },
    });
    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    const state = await prisma.systemState.findUnique({ where: { id: 1 } });
    if (!state) {
      return NextResponse.json({ error: 'System uninitialized' }, { status: 500 });
    }

    const ctx: ValidationContext = {
      tokenClaims: claims,
      systemPaused: state.systemPaused,
      maintenance: state.maintenance,
      stage: state.stage as 'S1' | 'S2',
      mission: {
        slug: mission.slug,
        missionId: mission.missionId,
        status: mission.status,
        expiresAt: mission.expiresAt,
        ownerAddress: mission.ownerAddress,
        agentAddress: mission.agentAddress,
        toolCap: BigInt(mission.toolCap.toString()),
        spentTool: BigInt(mission.spentTool.toString()),
        reservedTool: BigInt(mission.reservedTool.toString()),
        treasuryCap: BigInt(mission.treasuryCap.toString()),
        configVersion: mission.configVersion,
      },
    };

    const result = validateProposal(proposal, ctx);

    if (result.outcome === 'BLOCK') {
      // Record BLOCKED entry in audit ledger (04 §2, §5)
      await withLockOrder(
        async (tx) => {
          await appendAuditEntry(tx, {
            actor: claims.agent,
            amount: proposal.amount_atomic,
            chain_id: '43113',
            kind: 'BLOCKED',
            mission_id: claims.missionSlug,
            operation_id: '',
            policy_hash: claims.policyHash,
            policy_version: claims.missionConfigVersion.toString(),
            reason: result.reason || 'Blocked by validator',
            result_hash: '',
            rule: result.rule || 'VALIDATOR_BLOCK',
            source_key: `block:${Date.now()}:${Math.random().toString(36).substring(2)}`,
            to: (proposal as any).to || '',
            tx_hash: '',
          });
        },
        { missionSlug: claims.missionSlug, lockAuditHead: true }
      );

      return NextResponse.json(
        {
          outcome: 'BLOCK',
          rule: result.rule,
          reason: result.reason,
        },
        { status: 400 }
      );
    }

    if (result.outcome === 'QUEUE') {
      return NextResponse.json({
        outcome: 'QUEUE',
        rule: result.rule,
        reason: result.reason,
      });
    }

    return NextResponse.json({
      outcome: 'PASS',
      canonicalArguments: result.canonicalArguments,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
