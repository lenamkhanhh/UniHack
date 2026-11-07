import { prisma } from './db';
import {
  computePayloadHash,
  generateEip191Message,
  verifyOwnerSignature,
  ActionType,
} from './auth';
import { normalizeAddress, isValidAddress } from './chain';
import { getConfiguredOwner } from './config';

export class ChallengeError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'ChallengeError';
  }
}

const ALLOWED_PAYLOAD_KEYS: Record<ActionType, string[]> = {
  CREATE_MISSION: ['slug', 'agentAddress', 'treasuryCap', 'toolCap', 'durationSeconds', 'targetMissionSlug', 'payees'],
  ACTIVATE: ['missionId', 'ownerAddress', 'agentAddress', 'treasuryCap', 'toolCap', 'configVersion', 'policyHash', 'targetMissionSlug', 'fundingTxHash', 'payees', 'payeeRootTxHash'],
  READ_MISSION: ['slug', 'targetMissionSlug'],
  PAUSE_S1: ['desiredPaused'],
  CLOSE_MISSION_S1: ['slug', 'targetMissionSlug'],
  COMPLETE_MISSION: ['slug', 'deliverableHash', 'targetMissionSlug', 'anchorTxHash'],
  PREPARE_FEEDBACK: ['slug', 'deliverableHash', 'agentId', 'score', 'feedbackHash', 'targetMissionSlug'],
  PUBLISH_MISSION: ['slug', 'publicPublished', 'targetMissionSlug'],
  SUBMIT_FEEDBACK: ['operationId', 'score', 'tag1', 'tag2', 'txHash', 'targetMissionSlug'],
  CONFIRM_FUNDING: ['slug', 'txHash', 'targetMissionSlug'],
  CONFIRM_ANCHOR: ['slug', 'txHash', 'targetMissionSlug'],
};

export function validatePayloadTarget(
  action: ActionType,
  payload: any,
  targetMissionSlug?: string,
  targetMissionId?: string
) {
  if (!payload || typeof payload !== 'object') {
    throw new ChallengeError('Payload must be a non-null object', 400);
  }

  const allowed = ALLOWED_PAYLOAD_KEYS[action];
  if (allowed) {
    for (const k of Object.keys(payload)) {
      if (!allowed.includes(k)) {
        throw new ChallengeError(`Unknown field '${k}' in ${action} payload`, 400);
      }
    }
  }

  switch (action) {
    case 'CREATE_MISSION': {
      if (!payload.slug || typeof payload.slug !== 'string') {
        throw new ChallengeError('CREATE_MISSION payload missing slug', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('CREATE_MISSION slug mismatch with target', 400);
      }
      if (!payload.agentAddress || !payload.treasuryCap || !payload.toolCap || !payload.durationSeconds) {
        throw new ChallengeError('CREATE_MISSION payload missing required fields', 400);
      }
      if (payload.payees !== undefined) {
        if (!Array.isArray(payload.payees)) {
          throw new ChallengeError('CREATE_MISSION payees must be an array of addresses', 400);
        }
        for (const p of payload.payees) {
          if (!p || typeof p !== 'string' || !isValidAddress(p)) {
            throw new ChallengeError(`Invalid payee address: '${p}'`, 400);
          }
        }
      }
      break;
    }
    case 'ACTIVATE': {
      if (targetMissionId && payload.missionId !== targetMissionId) {
        throw new ChallengeError('ACTIVATE missionId mismatch with target', 400);
      }
      if (!payload.missionId || !payload.ownerAddress || !payload.agentAddress || !payload.treasuryCap || !payload.toolCap) {
        throw new ChallengeError('ACTIVATE payload missing required fields', 400);
      }
      if (payload.payees !== undefined) {
        if (!Array.isArray(payload.payees)) {
          throw new ChallengeError('ACTIVATE payees must be an array of addresses', 400);
        }
        for (const p of payload.payees) {
          if (!p || typeof p !== 'string' || !isValidAddress(p)) {
            throw new ChallengeError(`Invalid payee address: '${p}'`, 400);
          }
        }
      }
      break;
    }
    case 'READ_MISSION': {
      if (!payload.slug || typeof payload.slug !== 'string') {
        throw new ChallengeError('READ_MISSION payload missing slug', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('READ_MISSION slug mismatch with target', 400);
      }
      break;
    }
    case 'PAUSE_S1': {
      if (typeof payload.desiredPaused !== 'boolean') {
        throw new ChallengeError('PAUSE_S1 desiredPaused must be boolean', 400);
      }
      break;
    }
    case 'CLOSE_MISSION_S1': {
      if (!payload.slug || typeof payload.slug !== 'string') {
        throw new ChallengeError('CLOSE_MISSION_S1 payload missing slug', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('CLOSE_MISSION_S1 slug mismatch with target', 400);
      }
      break;
    }
    case 'COMPLETE_MISSION': {
      if (!payload.slug || typeof payload.slug !== 'string') {
        throw new ChallengeError('COMPLETE_MISSION payload missing slug', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('COMPLETE_MISSION slug mismatch with target', 400);
      }
      if (!payload.deliverableHash) {
        throw new ChallengeError('COMPLETE_MISSION payload missing deliverableHash', 400);
      }
      break;
    }
    case 'PREPARE_FEEDBACK': {
      if (!payload.slug || typeof payload.slug !== 'string') {
        throw new ChallengeError('PREPARE_FEEDBACK payload missing slug', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('PREPARE_FEEDBACK slug mismatch with target', 400);
      }
      if (!payload.deliverableHash || !payload.agentId || payload.score === undefined) {
        throw new ChallengeError('PREPARE_FEEDBACK payload missing required fields', 400);
      }
      break;
    }
    case 'PUBLISH_MISSION': {
      if (!payload.slug || typeof payload.slug !== 'string') {
        throw new ChallengeError('PUBLISH_MISSION payload missing slug', 400);
      }
      if (typeof payload.publicPublished !== 'boolean') {
        throw new ChallengeError('PUBLISH_MISSION payload missing publicPublished boolean', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('PUBLISH_MISSION target slug mismatch', 400);
      }
      break;
    }
    case 'SUBMIT_FEEDBACK': {
      if (!payload.operationId || typeof payload.operationId !== 'string') {
        throw new ChallengeError('SUBMIT_FEEDBACK payload missing operationId', 400);
      }
      break;
    }
    case 'CONFIRM_FUNDING': {
      if (!payload.slug || typeof payload.slug !== 'string' || !payload.txHash) {
        throw new ChallengeError('CONFIRM_FUNDING payload missing slug or txHash', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('CONFIRM_FUNDING slug mismatch with target', 400);
      }
      break;
    }
    case 'CONFIRM_ANCHOR': {
      if (!payload.slug || typeof payload.slug !== 'string' || !payload.txHash) {
        throw new ChallengeError('CONFIRM_ANCHOR payload missing slug or txHash', 400);
      }
      if (targetMissionSlug && payload.slug !== targetMissionSlug) {
        throw new ChallengeError('CONFIRM_ANCHOR slug mismatch with target', 400);
      }
      break;
    }
    default:
      throw new ChallengeError(`Unknown action: ${action}`, 400);
  }
}

export async function verifyAndConsumeChallenge(
  tx: any,
  params: {
    nonce: string;
    signature: `0x${string}`;
    action: ActionType;
    payload: any;
    expectedSigner: string;
    targetMissionSlug?: string;
    targetMissionId?: string;
    appOrigin?: string;
  }
) {
  const { nonce, signature, action, payload, expectedSigner, targetMissionSlug, targetMissionId } = params;

  // 1. Strict payload target validation
  validatePayloadTarget(action, payload, targetMissionSlug, targetMissionId);

  // 2. Fetch challenge record
  const challenge = await tx.authChallenge.findUnique({
    where: { nonce },
  });

  if (!challenge) {
    throw new ChallengeError('Challenge not found', 404);
  }

  const now = new Date();
  if (challenge.usedAt !== null || now > challenge.expiresAt) {
    throw new ChallengeError('Challenge expired or already used', 400);
  }

  if (challenge.action !== action) {
    throw new ChallengeError(`Action mismatch: expected ${challenge.action}, got ${action}`, 400);
  }

  if (normalizeAddress(challenge.expectedSigner) !== normalizeAddress(expectedSigner)) {
    throw new ChallengeError('Signer does not match expected challenge signer', 403);
  }

  // 3. Payload hash match
  const payloadHash = computePayloadHash(payload);
  if (payloadHash !== challenge.payloadHash) {
    throw new ChallengeError('Payload hash mismatch', 400);
  }

  // 4. Fetch SystemState
  const state = await tx.systemState.findUnique({ where: { id: 1 } });
  if (!state) {
    throw new ChallengeError('System uninitialized', 500);
  }

  if (challenge.authVersion !== state.authVersion) {
    throw new ChallengeError('Challenge authVersion outdated', 400);
  }

  if (challenge.deploymentId !== state.deploymentId) {
    throw new ChallengeError('Challenge deploymentId mismatch', 400);
  }

  // 5. Reconstruct EIP-191 message and verify owner signature
  const appOrigin = params.appOrigin || process.env.APP_ORIGIN || 'http://localhost:3000';
  const message = generateEip191Message({
    action,
    deploymentId: state.deploymentId,
    appOrigin,
    stage: state.stage as 'S1' | 'S2',
    guardAddress: state.guardAddress,
    authVersion: state.authVersion,
    payloadHash,
    nonce,
    issuedAt: Math.floor(challenge.createdAt.getTime() / 1000),
  });

  const isValid = await verifyOwnerSignature({
    message,
    signature,
    expectedSigner: challenge.expectedSigner,
  });

  if (!isValid) {
    throw new ChallengeError('Invalid owner signature', 401);
  }

  // 6. Atomic consume (conditional update with affected row check)
  const consumed = await tx.authChallenge.updateMany({
    where: {
      nonce,
      usedAt: null,
      expiresAt: { gt: now },
      action,
      payloadHash,
      expectedSigner: normalizeAddress(expectedSigner),
      deploymentId: state.deploymentId,
      authVersion: state.authVersion,
    },
    data: {
      usedAt: now,
    },
  });

  if (consumed.count !== 1) {
    throw new ChallengeError('Challenge already consumed or concurrent collision', 409);
  }

  return { challenge, state, message };
}
