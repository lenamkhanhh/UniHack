import { GET as getProof } from '../apps/web/app/api/missions/[slug]/proof/route';
import { prisma } from '../apps/web/lib/db';
import { canonicalAuditJson, computeEntryHash, INITIAL_PREV_HASH } from '../apps/web/lib/audit';
import { NextRequest } from 'next/server';
import { verifyProof } from './verify-proof';

async function main() {
  const slug = 'legacy-a';
  const c1 = canonicalAuditJson({
    actor: '0x1111111111111111111111111111111111111111', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:00:00.000Z',
    kind: 'TOOL_RESERVED', mission_id: slug, operation_id: 'op-1', policy_hash: '0x0', policy_version: '1', prev_hash: INITIAL_PREV_HASH,
    reason: 'leg1', result_hash: '', rule: '', source_key: 'entry:leg1', to: '', tx_hash: ''
  });
  const h1 = computeEntryHash(c1);

  const c2 = canonicalAuditJson({
    actor: '0x1111111111111111111111111111111111111111', amount: '0', chain_id: '43113', created_at: '2026-11-04T00:01:00.000Z',
    kind: 'TOOL_PAID', mission_id: slug, operation_id: 'op-2', policy_hash: '0x0', policy_version: '1', prev_hash: h1,
    reason: 'proj2', result_hash: '', rule: '', source_key: 'entry:proj2', to: '', tx_hash: ''
  });
  const h2 = computeEntryHash(c2);

  const baseMission = {
    slug,
    missionId: 'm-1',
    ownerAddress: '0x1111111111111111111111111111111111111111',
    agentAddress: '0x2222222222222222222222222222222222222222',
    operations: [],
    toolCap: 5000000n,
    spentTool: 0n,
    reservedTool: 0n,
    status: 'ACTIVE',
    publicPublished: true,
    auditHeadHash: h2,
    auditEntryCount: 2,
    createdAt: new Date(),
  };

  const origTx = prisma.$transaction;
  try {
    // 1. Truncated proof case (only 1 entry in DB when mission requires 2)
    (prisma as any).$transaction = async (fn: any) => fn({
      mission: { findUnique: async () => ({ ...baseMission }) },
      auditEntry: {
        findMany: async () => [
          {
            id: 1n,
            sourceKey: 'entry:leg1',
            canonicalJson: c1,
            entryHash: h1,
            prevHash: INITIAL_PREV_HASH,
            missionSlug: slug,
            missionSequence: 1,
            missionPrevHash: INITIAL_PREV_HASH,
            missionEntryHash: h1,
            missionCanonicalJson: c1,
          }
        ]
      }
    });

    const req = new NextRequest(`http://localhost:3000/api/missions/${slug}/proof?public=true`);
    const res = await getProof(req, { params: { slug } });
    const status = res.status;
    const body = await res.json();

    if (status !== 409) {
      throw new Error(`Oracle failure: expected status 409 for truncated proof, got ${status}`);
    }
    if (!body?.error || !body.error.includes('AUDIT_CHECKPOINT_MISMATCH') || !body.error.includes('Exported entry count (1) does not match persisted auditEntryCount (2)')) {
      throw new Error(`Oracle failure: unexpected error message: ${body?.error}`);
    }

    // 2. Full proof case (both entries present, matching persisted count 2)
    (prisma as any).$transaction = async (fn: any) => fn({
      mission: { findUnique: async () => ({ ...baseMission }) },
      auditEntry: {
        findMany: async () => [
          {
            id: 1n,
            sourceKey: 'entry:leg1',
            canonicalJson: c1,
            entryHash: h1,
            prevHash: INITIAL_PREV_HASH,
            missionSlug: slug,
            missionSequence: 1,
            missionPrevHash: INITIAL_PREV_HASH,
            missionEntryHash: h1,
            missionCanonicalJson: c1,
          },
          {
            id: 2n,
            sourceKey: 'entry:proj2',
            canonicalJson: c2,
            entryHash: h2,
            prevHash: h1,
            missionSlug: slug,
            missionSequence: 2,
            missionPrevHash: h1,
            missionEntryHash: h2,
            missionCanonicalJson: c2,
          }
        ]
      }
    });

    const validReq = new NextRequest(`http://localhost:3000/api/missions/${slug}/proof?public=true`);
    const validRes = await getProof(validReq, { params: { slug } });
    if (validRes.status !== 200) {
      throw new Error(`Oracle failure: expected status 200 for full proof, got ${validRes.status}`);
    }
    const validBody = await validRes.json();
    if (validBody.audit.checkpoint.entryCount !== 2 || validBody.audit.checkpoint.headHash !== h2) {
      throw new Error('Oracle failure: Checkpoint count or headHash mismatch in valid proof');
    }
    const verifierCheck = verifyProof(validBody.audit.entries, validBody.audit.checkpoint);
    if (!verifierCheck.valid) {
      throw new Error(`Oracle failure: Standalone verifyProof rejected valid proof: ${JSON.stringify(verifierCheck.errors)}`);
    }

    const output = {
      status,
      persistedCount: 2,
      exportCount: null,
      persistedHeadMatchesExport: false,
      exportValid: false,
      error: body?.error ?? null
    };

    console.log(`TRUNCATED_PERSISTED_PROOF ${JSON.stringify(output)}`);
  } finally {
    (prisma as any).$transaction = origTx;
  }
}

main().catch(err => {
  console.error('PROBE_FAILED:', err);
  process.exit(1);
});
