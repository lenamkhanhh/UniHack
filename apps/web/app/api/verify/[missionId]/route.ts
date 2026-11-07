import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { INITIAL_PREV_HASH } from '@/lib/audit';
import { keccak256, stringToBytes } from 'viem';

export async function GET(req: NextRequest, context: any) {
  try {
    const { missionId } = await context.params;

    // Look up mission by slug or missionId
    const mission = await prisma.mission.findFirst({
      where: {
        OR: [{ slug: missionId }, { missionId: missionId }],
      },
    });

    // Fetch audit entries
    let entries = await prisma.auditEntry.findMany({
      where: {
        OR: [
          { missionSlug: mission?.slug || missionId },
          { canonicalJson: { contains: `"mission_id":"${missionId}"` } },
        ],
      },
      orderBy: { id: 'asc' },
    });

    // If no entries in DB for this missionId, generate a mathematically verified demo chain
    if (!entries || entries.length === 0) {
      const entry0Json = JSON.stringify({
        actor: '0x976ea74026e726554db657fa54763abd0c3a0aa9',
        amount: '0',
        chain_id: '43113',
        created_at: '2026-11-07T08:00:00.000Z',
        kind: 'SESSION_WALLET_FUNDED',
        mission_id: missionId,
        operation_id: 'op_init',
        policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        policy_version: '1',
        prev_hash: INITIAL_PREV_HASH,
        reason: 'Fund mission session wallet with 5.00 USDC cap',
        result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        rule: '',
        source_key: `demo:init:${missionId}`,
        to: '0x5aadfb43ef8daf45dd80f4676345b7676f1d70e3',
        tx_hash: 'fuji_sim_funded',
      });
      const entry0Hash = keccak256(stringToBytes(entry0Json));

      const entry1Json = JSON.stringify({
        actor: '0x1111111111111111111111111111111111111111',
        amount: '100000',
        chain_id: '43113',
        created_at: '2026-11-07T08:00:05.000Z',
        kind: 'TOOL_PAID',
        mission_id: missionId,
        operation_id: 'op_search_01',
        policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        policy_version: '1',
        prev_hash: entry0Hash,
        reason: 'Purchase verified reference sources',
        result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        rule: '',
        source_key: `demo:search:${missionId}`,
        to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
        tx_hash: 'fuji_sim_settled_01',
      });
      const entry1Hash = keccak256(stringToBytes(entry1Json));

      const entry2Json = JSON.stringify({
        actor: '0x1111111111111111111111111111111111111111',
        amount: '500000',
        chain_id: '43113',
        created_at: '2026-11-07T08:00:10.000Z',
        kind: 'TOOL_PAID',
        mission_id: missionId,
        operation_id: 'op_summary_02',
        policy_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        policy_version: '1',
        prev_hash: entry1Hash,
        reason: 'Synthesize research deliverable',
        result_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        rule: '',
        source_key: `demo:summary:${missionId}`,
        to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
        tx_hash: 'fuji_sim_settled_02',
      });
      const entry2Hash = keccak256(stringToBytes(entry2Json));

      const demoEntries = [
        {
          id: 1,
          sourceKey: `demo:init:${missionId}`,
          prevHash: INITIAL_PREV_HASH,
          entryHash: entry0Hash,
          canonicalJson: entry0Json,
        },
        {
          id: 2,
          sourceKey: `demo:search:${missionId}`,
          prevHash: entry0Hash,
          entryHash: entry1Hash,
          canonicalJson: entry1Json,
        },
        {
          id: 3,
          sourceKey: `demo:summary:${missionId}`,
          prevHash: entry1Hash,
          entryHash: entry2Hash,
          canonicalJson: entry2Json,
        },
      ];

      return NextResponse.json({
        success: true,
        missionId,
        isSeededDemo: true,
        anchorStatus: {
          anchored: false,
          label: 'Chưa neo on-chain (MOCK)',
          note: 'Dữ liệu demo chuẩn bị sẵn có gắn nhãn DEMO SEED để kiểm thử độc lập.',
        },
        entries: demoEntries,
      });
    }

    const formatted = entries.map((e) => ({
      id: Number(e.id),
      sourceKey: e.sourceKey,
      prevHash: e.prevHash,
      entryHash: e.entryHash,
      canonicalJson: e.canonicalJson,
      missionSequence: e.missionSequence,
      createdAt: e.createdAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      missionId,
      isSeededDemo: false,
      anchorStatus: {
        anchored: false,
        label: 'Chưa neo on-chain (MOCK)',
        note: 'Giao dịch neo proof chưa broadcast lên Fuji (chờ owner cấp ví test mới).',
      },
      entries: formatted,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal verify lookup error' }, { status: 500 });
  }
}
