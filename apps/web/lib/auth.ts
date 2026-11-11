import { randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { verifyMessage, keccak256, stringToBytes } from 'viem';
import {
  CHAIN_ID,
  AUTH_CHALLENGE_TTL_SECONDS,
  OWNER_READ_TOKEN_TTL_SECONDS,
} from './constants';
import { normalizeAddress } from './chain';
import { getJwtSecret, getAppOrigin, getDeploymentId } from './config';

export interface ActionPayloadMap {
  CREATE_MISSION: {
    slug: string;
    agentAddress: string;
    treasuryCap: string;
    toolCap: string;
    durationSeconds: number;
  };
  ACTIVATE: {
    missionId: string;
    ownerAddress: string;
    agentAddress: string;
    treasuryCap: string;
    toolCap: string;
    expiresAt: string;
    configVersion: number;
    policyHash: string;
  };
  READ_MISSION: {
    slug: string;
    action: 'READ_MISSION';
  };
  PAUSE_S1: {
    desiredPaused: boolean;
  };
  CLOSE_MISSION_S1: {
    slug: string;
    action: 'CLOSE_MISSION_S1';
  };
  COMPLETE_MISSION: {
    slug: string;
    deliverableHash: string;
    agentId?: string;
    score?: number;
  };
  PREPARE_FEEDBACK: {
    slug: string;
    deliverableHash: string;
    agentId: string;
    score: number;
  };
  PUBLISH_MISSION: {
    slug: string;
    publicPublished: boolean;
  };
  SUBMIT_FEEDBACK: {
    operationId: string;
    score?: number;
    tag1?: string;
    tag2?: string;
    txHash?: string;
    targetMissionSlug?: string;
  };
  CONFIRM_FUNDING: {
    slug: string;
    txHash: string;
    targetMissionSlug?: string;
  };
  CONFIRM_ANCHOR: {
    slug: string;
    txHash: string;
    targetMissionSlug?: string;
  };
  RECONCILE_VALIDATION_REQUEST: {
    slug: string;
    txHash: string;
    chainId?: number;
    registryAddress?: string;
    ownerAddress?: string;
    targetMissionSlug?: string;
  };
}

export type ActionType = keyof ActionPayloadMap;

export interface TokenClaims {
  type: 'spend' | 'read';
  iss: string;
  aud: string;
  deploymentId: string;
  stage: 'S1' | 'S2';
  chainId: number;
  guardAddress: string;
  authVersion: number;
  missionSlug: string;
  missionId: string;
  owner: string;
  agent: string;
  missionConfigVersion: number;
  policyHash: string;
  jti: string;
  exp: number;
  iat: number;
}

export function canonicalJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj ?? '');
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(',')}]`;
  }
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`
  );
  return `{${entries.join(',')}}`;
}

export function computePayloadHash(payload: any): string {
  const canonical = canonicalJson(payload);
  return keccak256(stringToBytes(canonical));
}

export function generateEip191Message(params: {
  action: ActionType;
  deploymentId: string;
  appOrigin: string;
  stage: 'S1' | 'S2';
  guardAddress?: string | null;
  authVersion: number;
  payloadHash: string;
  nonce: string;
  issuedAt: number;
}): string {
  const guard = params.guardAddress
    ? normalizeAddress(params.guardAddress)
    : 'none';
  const challengeExpiresAt = params.issuedAt + AUTH_CHALLENGE_TTL_SECONDS;

  return [
    'Guarded Agent Economy',
    `action: ${params.action}`,
    `deployment: ${params.deploymentId}`,
    `domain: ${params.appOrigin}`,
    `chainId: ${CHAIN_ID}`,
    `stage: ${params.stage}`,
    `guard: ${guard}`,
    `authVersion: ${params.authVersion}`,
    `payloadHash: ${params.payloadHash}`,
    `nonce: ${params.nonce}`,
    `issuedAt: ${params.issuedAt}`,
    `challengeExpiresAt: ${challengeExpiresAt}`,
  ].join('\n');
}

export async function verifyOwnerSignature(params: {
  message: string;
  signature: `0x${string}`;
  expectedSigner: string;
}): Promise<boolean> {
  try {
    const valid = await verifyMessage({
      address: params.expectedSigner as `0x${string}`,
      message: params.message,
      signature: params.signature,
    });
    return valid;
  } catch (err) {
    return false;
  }
}

export async function issueSpendToken(params: {
  deploymentId: string;
  stage: 'S1' | 'S2';
  guardAddress?: string | null;
  authVersion: number;
  missionSlug: string;
  missionId: string;
  ownerAddress: string;
  agentAddress: string;
  missionConfigVersion: number;
  policyHash: string;
  missionExpiresAt: Date;
  appOrigin?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const missionExp = Math.floor(params.missionExpiresAt.getTime() / 1000);
  // Spend token expiry <= mission expiry, max 24h
  const exp = Math.min(now + 24 * 3600, missionExp);

  if (exp <= now) {
    throw new Error('Cannot issue spend token for expired mission');
  }

  const guard = params.guardAddress ? normalizeAddress(params.guardAddress) : 'none';
  const iss = params.appOrigin || getAppOrigin();

  const jwt = await new SignJWT({
    type: 'spend',
    deploymentId: params.deploymentId,
    stage: params.stage,
    chainId: CHAIN_ID,
    guardAddress: guard,
    authVersion: params.authVersion,
    missionSlug: params.missionSlug,
    missionId: params.missionId,
    owner: normalizeAddress(params.ownerAddress),
    agent: normalizeAddress(params.agentAddress),
    missionConfigVersion: params.missionConfigVersion,
    policyHash: params.policyHash,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer(iss)
    .setAudience('unihack')
    .setJti(randomBytes(16).toString('hex'))
    .sign(getJwtSecret());

  return jwt;
}

export async function issueReadToken(params: {
  deploymentId: string;
  stage: 'S1' | 'S2';
  guardAddress?: string | null;
  authVersion: number;
  missionSlug: string;
  missionId: string;
  ownerAddress: string;
  agentAddress: string;
  missionConfigVersion: number;
  policyHash: string;
  appOrigin?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 15 minute TTL for owner read token
  const exp = now + OWNER_READ_TOKEN_TTL_SECONDS;
  const guard = params.guardAddress ? normalizeAddress(params.guardAddress) : 'none';
  const iss = params.appOrigin || getAppOrigin();

  const jwt = await new SignJWT({
    type: 'read',
    deploymentId: params.deploymentId,
    stage: params.stage,
    chainId: CHAIN_ID,
    guardAddress: guard,
    authVersion: params.authVersion,
    missionSlug: params.missionSlug,
    missionId: params.missionId,
    owner: normalizeAddress(params.ownerAddress),
    agent: normalizeAddress(params.agentAddress),
    missionConfigVersion: params.missionConfigVersion,
    policyHash: params.policyHash,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer(iss)
    .setAudience('unihack')
    .setJti(randomBytes(16).toString('hex'))
    .sign(getJwtSecret());

  return jwt;
}

export async function verifyToken(
  token: string,
  options?: { expectedDeploymentId?: string; expectedStage?: string }
): Promise<TokenClaims> {
  const expectedIssuer = getAppOrigin();
  const expectedDeployment = options?.expectedDeploymentId || getDeploymentId();
  const expectedStage = options?.expectedStage || 'S1';

  const { payload } = await jwtVerify(token, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: expectedIssuer,
    audience: 'unihack',
    requiredClaims: [
      'exp',
      'iat',
      'jti',
      'type',
      'stage',
      'deploymentId',
      'chainId',
      'authVersion',
      'missionSlug',
      'missionId',
      'owner',
      'agent',
      'missionConfigVersion',
      'policyHash',
    ],
    clockTolerance: '15s',
  });

  const p = payload as Record<string, any>;
  if (p.type !== 'spend' && p.type !== 'read') {
    throw new Error(`Invalid token type: ${p.type}`);
  }

  if (p.deploymentId !== expectedDeployment) {
    throw new Error(`Token deploymentId mismatch: expected ${expectedDeployment}, got ${p.deploymentId}`);
  }

  if (p.stage !== expectedStage) {
    throw new Error(`Token stage mismatch: expected ${expectedStage}, got ${p.stage}`);
  }

  if (Number(p.chainId) !== CHAIN_ID) {
    throw new Error(`Token chainId mismatch: expected ${CHAIN_ID}, got ${p.chainId}`);
  }

  if (typeof p.exp !== 'number' || typeof p.iat !== 'number' || p.exp <= p.iat) {
    throw new Error('Malformed token claims: invalid expiration or issued-at timestamp');
  }

  return payload as unknown as TokenClaims;
}
