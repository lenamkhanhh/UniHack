import { ToolPurchaseProposal, TreasuryPayoutProposal } from './validator';

export function createSearchProposal(params: {
  missionId: string;
  query: string;
  reason?: string;
}): ToolPurchaseProposal {
  return {
    kind: 'tool_purchase',
    mission_id: params.missionId,
    tool_id: 'tool:search',
    amount_atomic: '100000',
    reason: params.reason || 'Search for academic sources',
    arguments: { query: params.query },
  };
}

export function createSummaryProposal(params: {
  missionId: string;
  text: string;
  reason?: string;
}): ToolPurchaseProposal {
  return {
    kind: 'tool_purchase',
    mission_id: params.missionId,
    tool_id: 'tool:summary',
    amount_atomic: '500000',
    reason: params.reason || 'Summarize the selected source document',
    arguments: { text: params.text },
  };
}

export function createTalkMeterProposal(params: {
  missionId: string;
  minuteIndex: number;
  reason?: string;
}): ToolPurchaseProposal {
  return {
    kind: 'tool_purchase',
    mission_id: params.missionId,
    tool_id: 'tool:talkmeter',
    amount_atomic: '50000',
    reason: params.reason || `Bill simulated meeting minute ${params.minuteIndex}`,
    arguments: { minuteIndex: params.minuteIndex },
  };
}

export function createTreasuryProposal(params: {
  missionId: string;
  to: string;
  amountAtomic: string;
  reason: string;
}): TreasuryPayoutProposal {
  return {
    kind: 'treasury_payout',
    mission_id: params.missionId,
    to: params.to,
    amount_atomic: params.amountAtomic,
    reason: params.reason,
  };
}

/**
 * UUID to bytes32 encoding according to 04 §3:
 * 16 zero bytes prefix + 16 bytes UUID (without hyphens) in hex order
 * e.g. 00112233-4455-6677-8899-aabbccddeeff ->
 * 0x0000000000000000000000000000000000112233445566778899aabbccddeeff
 */
export function encodeTreasuryRequestId(uuid: string): `0x${string}` {
  const hex = uuid.replace(/-/g, '').toLowerCase();
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID for treasury requestId: ${uuid}`);
  }
  const zeroPrefix = '00000000000000000000000000000000';
  return `0x${zeroPrefix}${hex}` as `0x${string}`;
}
