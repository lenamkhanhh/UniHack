import { privateKeyToAccount } from 'viem/accounts';
import { prisma } from '@/lib/db';
import {
  generateEip191Message,
  computePayloadHash,
  issueSpendToken,
  issueReadToken,
  TokenClaims,
} from '@/lib/auth';
import { hashUtf8, normalizeAddress } from '@/lib/chain';
import { CHAIN_ID } from '@/lib/constants';

// Well-known test accounts (Foundry test keys, no real funds)
export const TEST_OWNER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
export const TEST_AGENT_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

export const ownerAccount = privateKeyToAccount(TEST_OWNER_KEY);
export const agentAccount = privateKeyToAccount(TEST_AGENT_KEY);
export const sellerAddress = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

// Set explicit test-only environment variables
process.env.MISSION_TOKEN_SECRET =
  process.env.MISSION_TOKEN_SECRET ||
  'test-mission-token-secret-must-be-at-least-32-chars-long!';
process.env.SESSION_WALLET_SEED =
  process.env.SESSION_WALLET_SEED ||
  'test-isolated-session-wallet-seed-must-be-distinct-32chars!';
process.env.OWNER_ADDRESS =
  process.env.OWNER_ADDRESS || normalizeAddress(ownerAccount.address);
process.env.AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || TEST_AGENT_KEY;
process.env.DEPLOYMENT_ID =
  process.env.DEPLOYMENT_ID || 'unihack-test-deployment';
process.env.APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000';
process.env.PAYMENT_MODE = process.env.PAYMENT_MODE || 'MOCK';
process.env.SELLER_ADDRESS = process.env.SELLER_ADDRESS || sellerAddress;

export async function clearDatabase() {
  await prisma.auditEntry.deleteMany({});
  await prisma.toolOperation.deleteMany({});
  await prisma.toolSession.deleteMany({});
  await prisma.treasuryRequest.deleteMany({});
  await prisma.missionFeedback.deleteMany({});
  await (prisma as any).validationJob?.deleteMany?.({});
  await (prisma as any).bountyAttempt?.deleteMany?.({});
  await prisma.authChallenge.deleteMany({});
  await prisma.mission.deleteMany({});

  await prisma.systemState.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      deploymentId: 'unihack-test-deployment',
      stage: 'S1',
      authVersion: 1,
      systemPaused: false,
      maintenance: false,
    },
    update: {
      deploymentId: 'unihack-test-deployment',
      stage: 'S1',
      authVersion: 1,
      systemPaused: false,
      maintenance: false,
    },
  });

  await prisma.auditHead.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      lastHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
    update: {
      lastHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
  });
}

export async function createTestMission(params?: {
  slug?: string;
  toolCap?: bigint;
  treasuryCap?: bigint;
  durationSeconds?: number;
  status?: string;
  stage?: 'S1' | 'S2';
  payeesJson?: string;
  payeeRoot?: string;
  publicPublished?: boolean;
  auditHeadHash?: string;
  creationBlock?: bigint;
}) {
  const stage = params?.stage || 'S1';
  if (stage === 'S2') {
    await prisma.systemState.update({
      where: { id: 1 },
      data: { stage: 'S2' },
    });
  }

  const slug = params?.slug || `test-mission-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const missionId = hashUtf8(slug);
  const toolCap = params?.toolCap || 5_000_000n;
  const treasuryCap = params?.treasuryCap || 10_000_000n;
  const duration = params?.durationSeconds ?? 86400;
  const expiresAt = new Date(Date.now() + duration * 1000);
  const policyHash = hashUtf8(`policy:1:${treasuryCap}:${toolCap}`);

  const mission = await prisma.mission.create({
    data: {
      slug,
      missionId,
      ownerAddress: normalizeAddress(ownerAccount.address),
      agentAddress: normalizeAddress(agentAccount.address),
      treasuryCap: treasuryCap.toString(),
      toolCap: toolCap.toString(),
      spentTool: '0',
      reservedTool: '0',
      expiresAt,
      status: params?.status || 'ACTIVE',
      configVersion: 1,
      policyHash,
      payeesJson: params?.payeesJson,
      payeeRoot: params?.payeeRoot,
      publicPublished: params?.publicPublished ?? false,
      auditHeadHash: params?.auditHeadHash,
      creationBlock: params?.creationBlock,
    },
  });

  const spendToken = await issueSpendToken({
    deploymentId: 'unihack-test-deployment',
    stage,
    authVersion: 1,
    missionSlug: mission.slug,
    missionId: mission.missionId,
    ownerAddress: mission.ownerAddress,
    agentAddress: mission.agentAddress,
    missionConfigVersion: mission.configVersion,
    policyHash: mission.policyHash,
    missionExpiresAt: mission.expiresAt,
  });

  return { mission, spendToken };
}
