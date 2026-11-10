import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeAddress, hashUtf8 } from '@/lib/chain';
import { getConfiguredOwner } from '@/lib/config';
import { verifyAndConsumeChallenge, ChallengeError } from '@/lib/challenges';
import { toMissionDto } from '@/lib/dto';
import { verifyToken } from '@/lib/auth';
import {
  saveMissionPayees,
  computePayeeMerkleTree,
  buildSetMissionPayeeRootCalldata,
  PayeeMerkleTreeResult,
} from '@/lib/merkle';
import { getGuardedTreasuryAddress } from '@/lib/config';
import { verifyMissionCreationReceipt } from '@/lib/validator-job';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    let claims = null;
    if (token) {
      try {
        claims = await verifyToken(token);
      } catch {
        // invalid token
      }
    }

    const onchainRoots = await prisma.auditEntry.findMany({
      where: {
        sourceKey: { startsWith: 'payee_root:' },
      },
      select: { missionSlug: true },
    });
    const confirmedSlugs = new Set(
      onchainRoots.map((e) => e.missionSlug).filter(Boolean) as string[]
    );

    if (claims?.missionSlug) {
      const missions = await prisma.mission.findMany({
        where: { slug: claims.missionSlug },
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({
        missions: missions.map((m) =>
          toMissionDto(m, { hasOnchainPayeeRoot: confirmedSlugs.has(m.slug) })
        ),
      });
    }

    // Public listing only includes publicPublished missions (Finding R08)
    const missions = await prisma.mission.findMany({
      where: { publicPublished: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      missions: missions.map((m) =>
        toMissionDto(m, { hasOnchainPayeeRoot: confirmedSlugs.has(m.slug) })
      ),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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

    const { slug, agentAddress, treasuryCap, toolCap, durationSeconds } = payload;
    if (!slug || !agentAddress || !treasuryCap || !toolCap || !durationSeconds) {
      return NextResponse.json(
        { error: 'slug, agentAddress, treasuryCap, toolCap, durationSeconds are required in payload' },
        { status: 400 }
      );
    }

    const configuredOwner = getConfiguredOwner();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);
    const missionId = hashUtf8(slug);

    let payeeInfo: any = null;
    let payeesJson: string | null = null;
    let payeeRoot: string | null = null;
    let treeResult: PayeeMerkleTreeResult | null = null;

    // PV-F9: Use pure computePayeeMerkleTree first. Never poison in-memory cache before verification!
    if (Array.isArray(payload.payees) && payload.payees.length > 0) {
      treeResult = computePayeeMerkleTree(payload.payees);
      payeesJson = JSON.stringify(treeResult.payees);
      payeeRoot = treeResult.root;
      const guardedTreasuryAddress = getGuardedTreasuryAddress();
      const unsignedTx = {
        to: guardedTreasuryAddress,
        data: buildSetMissionPayeeRootCalldata(missionId, treeResult.root),
        value: '0',
        chainId: 43113,
      };

      payeeInfo = {
        root: treeResult.root,
        payees: treeResult.payees,
        status: 'PAYEE_ROOT_MOCK_NOT_SENT',
        unsignedTx,
      };
    }

    // PV-F9: Bind payeeRoot into policyHash
    const policyHash = hashUtf8(`policy:1:${treasuryCap}:${toolCap}:${payeeRoot || ''}`);

    let creationBlock: bigint | null = null;
    const receiptTxHash = payload.receiptTxHash || payload.creationReceiptTxHash;
    if (receiptTxHash) {
      const verifyRes = await verifyMissionCreationReceipt({
        receiptTxHash,
        expectedMissionId: missionId,
      });
      if (!verifyRes.valid) {
        return NextResponse.json(
          { error: `Invalid creation receipt: ${verifyRes.error}` },
          { status: 400 }
        );
      }
      creationBlock = verifyRes.creationBlock ?? null;
    } else if (payload.creationBlock !== undefined && payload.creationBlock !== null && process.env.TEST_ALLOW_UNVERIFIED_CREATION_BLOCK === '1') {
      // Test harness only: explicit flag to test legacy/unverified block paths
      try {
        creationBlock = BigInt(payload.creationBlock);
      } catch {}
    }
    // Note: without verified on-chain receipt, creationBlock remains null (UNVERIFIED_PENDING_RECEIPT)

    const result = await prisma.$transaction(async (tx) => {
      await verifyAndConsumeChallenge(tx, {
        nonce,
        signature,
        action: 'CREATE_MISSION',
        payload,
        expectedSigner: configuredOwner,
        targetMissionSlug: slug,
      });

      const mission = await tx.mission.create({
        data: {
          slug,
          missionId,
          ownerAddress: configuredOwner,
          agentAddress: normalizeAddress(agentAddress),
          treasuryCap: treasuryCap.toString(),
          toolCap: toolCap.toString(),
          spentTool: '0',
          reservedTool: '0',
          expiresAt,
          status: 'ACTIVE',
          payeesJson,
          payeeRoot,
          creationBlock,
          configVersion: 1,
          policyHash,
        },
      });

      return mission;
    });

    // PV-F9: Only save to in-memory store AFTER transaction commits successfully
    if (treeResult && treeResult.payees.length > 0) {
      saveMissionPayees(slug, treeResult.payees);
    }

    return NextResponse.json({ mission: toMissionDto(result), payeeInfo }, { status: 201 });
  } catch (err: any) {
    if (err instanceof ChallengeError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Mission slug or missionId already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
