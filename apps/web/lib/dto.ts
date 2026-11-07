/**
 * DTO mappers for safe API response serialization.
 * Enforces field allowlists, converts BigInt and Decimal to string, and strips server-only fields.
 * Spec: 05 §2, §4, Findings F12, F13.
 */

export function toOperationDto(
  op: any,
  options?: { includeResult?: boolean }
) {
  if (!op) return null;

  const result =
    options?.includeResult && op.state === 'SETTLED' && op.heldResult
      ? JSON.parse(op.heldResult)
      : null;

  return {
    operationId: op.operationId,
    toolId: op.toolId,
    state: op.state,
    paymentMode: op.paymentMode ?? 'LIVE_FUJI',
    reservedAmount: op.reservedAmount?.toString() ?? '0',
    authFrom: op.authFrom ?? null,
    authTo: op.authTo ?? null,
    authValue: op.authValue?.toString() ?? null,
    authNonce: op.authNonce ?? null,
    validAfter: op.validAfter?.toString() ?? null,
    validBefore: op.validBefore?.toString() ?? null,
    txHash: op.txHash ?? null,
    receiptBlockNumber: op.receiptBlockNumber?.toString() ?? null,
    receiptBlockHash: op.receiptBlockHash ?? null,
    failureReason: op.failureReason ?? null,
    result,
    heldResultHash: op.heldResultHash ?? null,
    sessionId: op.sessionId ?? null,
    minuteIndex: op.minuteIndex ?? null,
    createdAt: op.createdAt instanceof Date ? op.createdAt.toISOString() : op.createdAt,
    updatedAt: op.updatedAt instanceof Date ? op.updatedAt.toISOString() : op.updatedAt,
  };
}

export function toAuditEntryDto(entry: any) {
  if (!entry) return null;

  return {
    id: entry.id?.toString() ?? '0',
    sourceKey: entry.sourceKey,
    prevHash: entry.prevHash,
    entryHash: entry.entryHash,
    canonicalJson: entry.canonicalJson,
    createdAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : entry.createdAt,
  };
}

export function toMissionDto(
  mission: any,
  options?: { hasOnchainPayeeRoot?: boolean }
) {
  if (!mission) return null;

  return {
    slug: mission.slug,
    missionId: mission.missionId,
    ownerAddress: mission.ownerAddress,
    agentAddress: mission.agentAddress,
    treasuryCap: mission.treasuryCap?.toString() ?? '0',
    toolCap: mission.toolCap?.toString() ?? '0',
    spentTool: mission.spentTool?.toString() ?? '0',
    reservedTool: mission.reservedTool?.toString() ?? '0',
    expiresAt: mission.expiresAt instanceof Date ? mission.expiresAt.toISOString() : mission.expiresAt,
    status: mission.status,
    completedAt: mission.completedAt instanceof Date ? mission.completedAt.toISOString() : (mission.completedAt ?? null),
    deliverableHash: mission.deliverableHash ?? null,
    payeesJson: mission.payeesJson ?? null,
    payeeRoot: mission.payeeRoot ?? null,
    payeeRootConfirmedOnchain: Boolean(options?.hasOnchainPayeeRoot),
    configVersion: mission.configVersion ?? 1,
    policyHash: mission.policyHash,
    publicPublished: Boolean(mission.publicPublished),
    createdAt: mission.createdAt instanceof Date ? mission.createdAt.toISOString() : mission.createdAt,
    updatedAt: mission.updatedAt instanceof Date ? mission.updatedAt.toISOString() : mission.updatedAt,
  };
}

export function toSessionDto(session: any) {
  if (!session) return null;

  return {
    id: session.id,
    missionSlug: session.missionSlug,
    payerAddress: session.payerAddress,
    rate: session.rate?.toString() ?? '0',
    cap: session.cap?.toString() ?? '0',
    spent: session.spent?.toString() ?? '0',
    reserved: session.reserved?.toString() ?? '0',
    status: session.status,
    startedAt: session.startedAt instanceof Date ? session.startedAt.toISOString() : session.startedAt,
    stoppedAt: session.stoppedAt instanceof Date ? session.stoppedAt.toISOString() : (session.stoppedAt ?? null),
  };
}
