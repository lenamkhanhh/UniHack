import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { INITIAL_PREV_HASH } from '@/lib/audit';
import { keccak256, stringToBytes } from 'viem';

// Clear sandbox addresses (WOW-F6) — not Anvil, not real wallets
const SANDBOX_OWNER = '0x00000000000000000000000000000000000A11CE';
const SANDBOX_AGENT = '0x00000000000000000000000000000000000A6E47';
const SANDBOX_MERCHANT = '0x0000000000000000000000000000000000070015';

export async function GET(req: NextRequest, context: any) {
  try {
    const { missionId } = await context.params;

    // Fixed id for offline presentation demo (WOW-F2)
    if (missionId === 'demo-seed') {
      const entry0Json = JSON.stringify({
        actor: SANDBOX_OWNER,
        amount: '0',
        chain_id: '43113',
        created_at: '2026-11-07T08:00:00.000Z',
        kind: 'SESSION_WALLET_FUNDED',
        mission_id: 'demo-seed',
        operation_id: 'op_seed_init',
        policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        policy_version: '1',
        prev_hash: INITIAL_PREV_HASH,
        reason: 'Fund mission session wallet with 5.00 USDC cap (DEMO SEED)',
        result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        rule: '',
        source_key: 'seed:init:demo-seed',
        to: SANDBOX_AGENT,
        tx_hash: '', // Honest: empty tx_hash (WOW-F2)
      });
      const entry0Hash = keccak256(stringToBytes(entry0Json));

      const entry1Json = JSON.stringify({
        actor: SANDBOX_AGENT,
        amount: '100000',
        chain_id: '43113',
        created_at: '2026-11-07T08:00:05.000Z',
        kind: 'TOOL_PAID',
        mission_id: 'demo-seed',
        operation_id: 'op_seed_search',
        policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        policy_version: '1',
        prev_hash: entry0Hash,
        reason: 'Purchase verified reference sources (DEMO SEED)',
        result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        rule: '',
        source_key: 'seed:search:demo-seed',
        to: SANDBOX_MERCHANT,
        tx_hash: '', // Honest: empty tx_hash (WOW-F2)
      });
      const entry1Hash = keccak256(stringToBytes(entry1Json));

      const entry2Json = JSON.stringify({
        actor: SANDBOX_AGENT,
        amount: '500000',
        chain_id: '43113',
        created_at: '2026-11-07T08:00:10.000Z',
        kind: 'TOOL_PAID',
        mission_id: 'demo-seed',
        operation_id: 'op_seed_summary',
        policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        policy_version: '1',
        prev_hash: entry1Hash,
        reason: 'Synthesize research deliverable (DEMO SEED)',
        result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        rule: '',
        source_key: 'seed:summary:demo-seed',
        to: SANDBOX_MERCHANT,
        tx_hash: '', // Honest: empty tx_hash (WOW-F2)
      });
      const entry2Hash = keccak256(stringToBytes(entry2Json));

      const demoEntries = [
        {
          id: 1,
          sourceKey: 'seed:init:demo-seed',
          prevHash: INITIAL_PREV_HASH,
          entryHash: entry0Hash,
          canonicalJson: entry0Json,
        },
        {
          id: 2,
          sourceKey: 'seed:search:demo-seed',
          prevHash: entry0Hash,
          entryHash: entry1Hash,
          canonicalJson: entry1Json,
        },
        {
          id: 3,
          sourceKey: 'seed:summary:demo-seed',
          prevHash: entry1Hash,
          entryHash: entry2Hash,
          canonicalJson: entry2Json,
        },
      ];

      return NextResponse.json({
        success: true,
        missionId: 'demo-seed',
        isSeededDemo: true,
        anchorStatus: {
          anchored: false,
          label: 'DEMO SEED — Chưa neo on-chain',
          note: 'Dữ liệu mô phỏng chuẩn bị sẵn cho máy chiếu offline, tx_hash rỗng.',
        },
        entries: demoEntries,
      });
    }

    // Look up mission in database; non-existent returns 404 (WOW-F2)
    const mission = await prisma.mission.findFirst({
      where: {
        OR: [{ slug: missionId }, { missionId: missionId }],
      },
    });

    if (!mission) {
      return NextResponse.json(
        { error: 'Không tìm thấy mission', success: false },
        { status: 404 }
      );
    }

    // Fetch real audit entries strictly bound to this mission
    const entries = await prisma.auditEntry.findMany({
      where: {
        missionSlug: mission.slug,
      },
      orderBy: { missionSequence: 'asc' },
    });

    const formatted = entries.map((e) => ({
      id: Number(e.id),
      sourceKey: e.sourceKey,
      prevHash: e.missionPrevHash || e.prevHash,
      entryHash: e.missionEntryHash || e.entryHash,
      canonicalJson: e.missionCanonicalJson || e.canonicalJson,
      missionSequence: e.missionSequence,
      createdAt: e.createdAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      missionId,
      isSeededDemo: false,
      anchorStatus: {
        anchored: Boolean(mission.auditHeadHash && mission.status === 'COMPLETED'),
        label: mission.auditHeadHash ? 'Đã neo on-chain (Fuji)' : 'Chưa neo on-chain (MOCK)',
        note: 'Giao dịch thật từ cơ sở dữ liệu hệ thống.',
      },
      entries: formatted,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal verify lookup error' }, { status: 500 });
  }
}
