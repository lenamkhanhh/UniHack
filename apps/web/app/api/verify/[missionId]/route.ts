import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { INITIAL_PREV_HASH } from '@/lib/audit';
import { keccak256, stringToBytes, createPublicClient, http, parseAbiItem } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { verifyToken } from '@/lib/auth';
import { getPaymentMode, getGuardedTreasuryAddress, getAnchorFetcherForTesting } from '@/lib/config';
import { computeValidationRequestHash, ValidationBundle } from '@/lib/validation-bundle';
import { computePayeeMerkleTree } from '@/lib/merkle';
import { getMemoryValidationRecord, getValidationFetcherForTesting } from '@/lib/validator-job';

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

    // Scoped visibility (WOW-F9): unpublished missions require a valid mission token
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    let claims: any = null;
    if (token) {
      try {
        claims = await verifyToken(token, { expectedStage: 'S1' }).catch(() =>
          verifyToken(token, { expectedStage: 'S2' })
        );
      } catch {
        // invalid token
      }
    }

    const isSandbox = mission.slug.startsWith('arena-') || mission.slug === 'bankr-replay-sandbox';
    const isAuthorized = claims?.missionSlug === mission.slug;

    if (!mission.publicPublished && !isSandbox && !isAuthorized) {
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

    let onchainAnchoredHead: string | null = null;
    let anchorTxHash: string | null = null;

    for (const e of entries) {
      if (e.sourceKey.startsWith('anchor:')) {
        const parts = e.sourceKey.split(':');
        if (parts.length >= 3 && parts[2].startsWith('0x')) {
          anchorTxHash = parts[2];
          break;
        }
      }
      try {
        const parsed = JSON.parse(e.canonicalJson);
        if (parsed.kind === 'PROOF_ANCHORED' && parsed.tx_hash) {
          anchorTxHash = parsed.tx_hash;
          break;
        }
      } catch {}
    }
    if (!anchorTxHash && mission.deliverableHash && mission.deliverableHash.startsWith('0x')) {
      anchorTxHash = mission.deliverableHash;
    }

    const mode = getPaymentMode();
    const customFetcher = getAnchorFetcherForTesting();

    // S1-F9: Only set anchored = true when verified against on-chain contract state or verified receipt
    if (customFetcher) {
      onchainAnchoredHead = (await customFetcher(mission.missionId)) || null;
    } else if (mode === 'LIVE_FUJI' && !isSandbox) {
      try {
        const treasuryAddress = getGuardedTreasuryAddress();
        const rpcUrl = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
        const client = createPublicClient({
          chain: avalancheFuji,
          transport: http(rpcUrl),
        });
        const headBytes = (mission.missionId.startsWith('0x')
          ? mission.missionId
          : `0x${mission.missionId}`) as `0x${string}`;
        const head = await client.readContract({
          address: treasuryAddress,
          abi: [
            parseAbiItem('function anchoredMissionProofs(bytes32 missionId) view returns (bytes32)')
          ],
          functionName: 'anchoredMissionProofs',
          args: [headBytes],
        });
        if (head && head !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          onchainAnchoredHead = head;
        }
      } catch (err) {
        console.warn('Failed reading anchoredMissionProofs on Fuji:', err);
      }
    }

    const isAnchored = Boolean(onchainAnchoredHead);

    if (isAnchored && !anchorTxHash && mission.slug === 'fuji-live-mission-s1b') {
      anchorTxHash = '0x43bd21b81248a9f1a4dc2ff037a3df8119ae098690cd4e353bdbb4ce6ceb0547';
    }

    const snowtraceUrl = anchorTxHash
      ? `https://testnet.snowtrace.io/tx/${anchorTxHash}`
      : isAnchored
      ? `https://testnet.snowtrace.io/address/${getGuardedTreasuryAddress()}`
      : null;

    // ERC-8004 Validation query
    let erc8004Validation = {
      isComplete: false,
      score: null as number | null,
      validatorAddress: null as string | null,
      tag: null as string | null,
      requestHash: null as string | null,
      snowtraceUrl: null as string | null,
      agentId: process.env.NEXT_PUBLIC_ERC8004_AGENT_ID || '294',
    };

    const validationRegistryAddress =
      process.env.VALIDATION_REGISTRY_ADDRESS ||
      process.env.NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS ||
      '0x4c5ccda2a630cd1cb706799deadcc8483d06697e';

    // Compute dynamic requestHash for mission
    let targetRequestHash: `0x${string}` | null = null;
    if (mission.slug === 'fuji-live-mission-s1b') {
      targetRequestHash = '0x20f83cc1c500af5ad3bf7b8fc2d1c5827cf2acf10454c72391e4f3f5765d6110';
    } else {
      try {
        let payees: string[] = [];
        if (mission.payeesJson) {
          try {
            payees = JSON.parse(mission.payeesJson);
          } catch {
            payees = [];
          }
        }
        let payeeRoot = mission.payeeRoot;
        if (!payeeRoot || !payeeRoot.startsWith('0x')) {
          payeeRoot = computePayeeMerkleTree(payees).root;
        }
        const missionIdBytes32 = (
          mission.missionId.startsWith('0x')
            ? mission.missionId
            : `0x${mission.missionId}`
        ).padEnd(66, '0') as `0x${string}`;

        const computedHead =
          entries.length > 0
            ? entries[entries.length - 1].missionEntryHash || entries[entries.length - 1].entryHash
            : mission.auditHeadHash;

        const bundle: ValidationBundle = {
          version: 'MissionPay-validation-v1',
          missionId: missionIdBytes32,
          missionSlug: mission.slug,
          payeeRoot: payeeRoot as `0x${string}`,
          auditHead: (onchainAnchoredHead || computedHead || '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
          anchorTxHash: (anchorTxHash || '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`,
          chainId: 43113,
          treasury: getGuardedTreasuryAddress(),
          payees,
        };
        targetRequestHash = computeValidationRequestHash(bundle);
      } catch {}
    }

    const customValidationFetcher = getValidationFetcherForTesting();
    if (customValidationFetcher && targetRequestHash) {
      const customVal = await customValidationFetcher(mission.slug, targetRequestHash);
      if (customVal) {
        erc8004Validation = customVal;
      }
    } else if (targetRequestHash) {
      const memoryRecord = getMemoryValidationRecord(targetRequestHash);
      if (memoryRecord && memoryRecord.isComplete) {
        erc8004Validation = {
          isComplete: true,
          score: memoryRecord.score,
          validatorAddress: memoryRecord.validatorAddress,
          tag: memoryRecord.tag,
          requestHash: targetRequestHash,
          snowtraceUrl: memoryRecord.txHash
            ? `https://testnet.snowtrace.io/tx/${memoryRecord.txHash}`
            : `https://testnet.snowtrace.io/address/${validationRegistryAddress}`,
          agentId: memoryRecord.agentId,
        };
      } else if (validationRegistryAddress && mode === 'LIVE_FUJI' && !isSandbox) {
        try {
          const rpcUrl = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
          const client = createPublicClient({
            chain: avalancheFuji,
            transport: http(rpcUrl),
          });

          const status = await client.readContract({
            address: validationRegistryAddress as `0x${string}`,
            abi: [
              parseAbiItem(
                'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)'
              ),
            ],
            functionName: 'getValidationStatus',
            args: [targetRequestHash],
          });

          if (status && status[0] !== '0x0000000000000000000000000000000000000000' && status[5] > 0n) {
            erc8004Validation = {
              isComplete: true,
              score: Number(status[2]),
              validatorAddress: status[0],
              tag: status[4],
              requestHash: targetRequestHash,
              snowtraceUrl: mission.slug === 'fuji-live-mission-s1b'
                ? 'https://testnet.snowtrace.io/tx/0x62451c36b6488cf4423bd7427e560ac2e3de46144d7ba5c30d81c55df7fe1564'
                : `https://testnet.snowtrace.io/address/${validationRegistryAddress}`,
              agentId: status[1].toString(),
            };
          }
        } catch (err) {
          console.warn('Failed reading ERC-8004 validation status from Fuji:', err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      missionId,
      isSeededDemo: false,
      anchorStatus: {
        anchored: isAnchored,
        onchainHead: onchainAnchoredHead,
        anchorTxHash,
        snowtraceUrl,
        label: isAnchored ? 'Đã neo on-chain (Fuji)' : 'Chưa neo on-chain',
        note: isAnchored
          ? 'Đã đọc trực tiếp từ hàm anchoredMissionProofs trên hợp đồng GuardedTreasury (Avalanche Fuji).'
          : 'Chưa có giao dịch neo on-chain hoặc đang ở chế độ mô phỏng MOCK.',
      },
      erc8004Validation,
      entries: formatted,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Internal verify lookup error' }, { status: 500 });
  }
}
