import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { INITIAL_PREV_HASH } from '@/lib/audit';
import { keccak256, stringToBytes, createPublicClient, http, parseAbiItem, verifyMessage } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { verifyToken } from '@/lib/auth';
import { normalizeAddress } from '@/lib/chain';
import { getPaymentMode, getGuardedTreasuryAddress, getAnchorFetcherForTesting } from '@/lib/config';
import { computeValidationRequestHash, ValidationBundle } from '@/lib/validation-bundle';
import { computePayeeMerkleTree } from '@/lib/merkle';
import {
  getMemoryValidationRecord,
  getValidationFetcherForTesting,
  reconcileOwnerValidationRequestReceipt,
} from '@/lib/validator-job';

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

    const snowtraceUrl = anchorTxHash
      ? `https://testnet.snowtrace.io/tx/${anchorTxHash}`
      : isAnchored
      ? `https://testnet.snowtrace.io/address/${getGuardedTreasuryAddress()}`
      : null;

    // ERC-8004 Validation query
    const validationRegistryAddress =
      process.env.VALIDATION_REGISTRY_ADDRESS ||
      process.env.NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS ||
      '0x4c5ccda2a630cd1cb706799deadcc8483d06697e';

    let erc8004Validation = {
      isComplete: false,
      status: 'NOT_EVALUATED',
      score: null as number | null,
      chainScore: null as number | null,
      localScore: null as number | null,
      validatorAddress: null as string | null,
      tag: null as string | null,
      chainTag: null as string | null,
      localTag: null as string | null,
      responseHash: null as string | null,
      requestHash: null as string | null,
      requestTxHash: null as string | null,
      responseTxHash: null as string | null,
      unsignedRequest: null as any,
      snowtraceUrl: null as string | null,
      agentId: process.env.NEXT_PUBLIC_ERC8004_AGENT_ID || '294',
      failureReason: null as string | null,
    };

    // First check persistent database state (ValidationJob). Never swallow DB errors into memory fallback.
    let dbJob = null;
    try {
      dbJob = await prisma.validationJob.findUnique({
        where: { missionSlug: mission.slug },
      });
    } catch (dbErr: any) {
      return NextResponse.json(
        { error: 'DATABASE_UNAVAILABLE', message: 'Persistent database storage is currently unavailable' },
        { status: 503 }
      );
    }

    // Compute dynamic requestHash from CURRENT bundle context (A4.4)
    let targetRequestHash: `0x${string}` | null = null;
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
        creationBlock: mission.creationBlock ?? undefined,
      };
      targetRequestHash = computeValidationRequestHash(bundle);
    } catch {}

    if (dbJob) {
      // Compare persisted requestHash/context to current bundle before showing completed job
      if (targetRequestHash && dbJob.requestHash.toLowerCase() !== targetRequestHash.toLowerCase()) {
        erc8004Validation = {
          isComplete: false,
          status: 'STALE_CONTEXT',
          score: null,
          chainScore: null,
          localScore: dbJob.score,
          validatorAddress: dbJob.validatorAddress,
          tag: 'stale-context-mismatch',
          chainTag: null,
          localTag: dbJob.tag,
          responseHash: null,
          requestHash: targetRequestHash,
          requestTxHash: null,
          responseTxHash: null,
          unsignedRequest: null,
          snowtraceUrl: null,
          agentId: dbJob.agentId || process.env.NEXT_PUBLIC_ERC8004_AGENT_ID || '294',
          failureReason: 'Bundle context has changed since validation job was created; old completion cannot be reused',
        };
      } else {
        let unsignedRequestParsed: any = null;
        if (dbJob.unsignedRequest) {
          try {
            unsignedRequestParsed = JSON.parse(dbJob.unsignedRequest);
          } catch {}
        }
        erc8004Validation = {
          isComplete: dbJob.status === 'RESPONSE_CONFIRMED',
          status: dbJob.status,
          score: dbJob.chainScore ?? dbJob.score,
          chainScore: dbJob.chainScore,
          localScore: dbJob.score,
          validatorAddress: dbJob.validatorAddress,
          tag: dbJob.chainTag ?? dbJob.tag,
          chainTag: dbJob.chainTag,
          localTag: dbJob.tag,
          responseHash: dbJob.responseHash,
          requestHash: dbJob.requestHash,
          requestTxHash: dbJob.requestTxHash,
          responseTxHash: dbJob.responseTxHash,
          unsignedRequest: unsignedRequestParsed,
          snowtraceUrl: dbJob.responseTxHash
            ? `https://testnet.snowtrace.io/tx/${dbJob.responseTxHash}`
            : dbJob.requestTxHash
            ? `https://testnet.snowtrace.io/tx/${dbJob.requestTxHash}`
            : `https://testnet.snowtrace.io/address/${validationRegistryAddress}`,
          agentId: dbJob.agentId || process.env.NEXT_PUBLIC_ERC8004_AGENT_ID || '294',
          failureReason: dbJob.failureReason,
        };
      }
    }

    const customValidationFetcher = getValidationFetcherForTesting();
    if (customValidationFetcher && targetRequestHash) {
      const customVal = await customValidationFetcher(mission.slug, targetRequestHash);
      if (customVal) {
        erc8004Validation = {
          ...erc8004Validation,
          ...customVal,
        };
      }
    } else if (!dbJob && targetRequestHash && (mode === 'MOCK' || isSandbox)) {
      const memoryRecord = getMemoryValidationRecord(targetRequestHash);
      if (memoryRecord) {
        erc8004Validation = {
          isComplete: Boolean(memoryRecord.isComplete),
          status: memoryRecord.status || (memoryRecord.isComplete ? 'RESPONSE_CONFIRMED' : 'LOCAL_EVALUATED'),
          score: memoryRecord.score ?? null,
          chainScore: memoryRecord.score ?? null,
          localScore: memoryRecord.score ?? null,
          validatorAddress: memoryRecord.validatorAddress || null,
          tag: memoryRecord.tag || null,
          chainTag: memoryRecord.tag || null,
          localTag: memoryRecord.tag || null,
          responseHash: null,
          requestHash: targetRequestHash,
          requestTxHash: null,
          responseTxHash: memoryRecord.txHash || null,
          unsignedRequest: memoryRecord.unsignedRequest || null,
          snowtraceUrl: memoryRecord.txHash
            ? `https://testnet.snowtrace.io/tx/${memoryRecord.txHash}`
            : `https://testnet.snowtrace.io/address/${validationRegistryAddress}`,
          agentId: memoryRecord.agentId || process.env.NEXT_PUBLIC_ERC8004_AGENT_ID || '294',
          failureReason: memoryRecord.failureReason || null,
        };
      } else if (validationRegistryAddress && mode === 'LIVE_FUJI' && !isSandbox) {
        try {
          const rpcUrl = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
          const client = createPublicClient({
            chain: avalancheFuji,
            transport: http(rpcUrl),
          });

          const isComplete = (await client.readContract({
            address: validationRegistryAddress as `0x${string}`,
            abi: [
              parseAbiItem(
                'function isValidationComplete(bytes32 requestHash) view returns (bool)'
              ),
            ],
            functionName: 'isValidationComplete',
            args: [targetRequestHash],
          })) as boolean;

          const status = (await client.readContract({
            address: validationRegistryAddress as `0x${string}`,
            abi: [
              parseAbiItem(
                'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)'
              ),
            ],
            functionName: 'getValidationStatus',
            args: [targetRequestHash],
          })) as readonly [string, bigint, number, string, string, bigint];

          if (status && status[0] !== '0x0000000000000000000000000000000000000000' && status[5] > 0n) {
            erc8004Validation = {
              isComplete: Boolean(isComplete),
              status: isComplete ? 'RESPONSE_CONFIRMED' : 'RESPONSE_PENDING',
              score: Number(status[2]),
              chainScore: Number(status[2]),
              localScore: null,
              validatorAddress: status[0],
              tag: status[4],
              chainTag: status[4],
              localTag: null,
              responseHash: status[3],
              requestHash: targetRequestHash,
              requestTxHash: null,
              responseTxHash: null,
              unsignedRequest: null,
              snowtraceUrl: `https://testnet.snowtrace.io/address/${validationRegistryAddress}`,
              agentId: status[1].toString(),
              failureReason: null,
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
    return NextResponse.json({ error: 'DATABASE_UNAVAILABLE', details: err?.message }, { status: 503 });
  }
}

export async function POST(req: NextRequest, context: any) {
  try {
    const { missionId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const { txHash } = body;

    if (!txHash || typeof txHash !== 'string') {
      return NextResponse.json({ error: 'txHash is required' }, { status: 400 });
    }

    const mission = await prisma.mission.findUnique({
      where: { slug: missionId },
    });

    if (!mission) {
      return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
    }

    // Owner authorization: Bearer token OR fresh owner-signed challenge
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const signature = req.headers.get('x-owner-signature') || body.authSignature || body.signature;
    const signer = req.headers.get('x-owner-signer') || body.authSigner || body.signer;
    let message = req.headers.get('x-auth-message') || body.authMessage || body.message;
    if (message && typeof message === 'string') {
      try {
        message = decodeURIComponent(message);
      } catch {}
    }

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
          { error: 'Unauthorized: signature signer does not match mission owner' },
          { status: 403 }
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

    const result = await reconcileOwnerValidationRequestReceipt(mission.slug, txHash);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Reconciliation error' }, { status: 500 });
  }
}
