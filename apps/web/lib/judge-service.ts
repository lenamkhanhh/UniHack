import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  http,
  isAddress,
  getAddress,
  encodeFunctionData,
  parseAbiItem,
  keccak256,
  toHex,
  Hex,
  Address,
  Hash,
  PublicClient,
  formatUnits,
} from 'viem';
import { avalancheFuji } from 'viem/chains';

// ============================================================================
// RECEIPTS SERVICE
// ============================================================================

export interface JudgeReceiptItem {
  id: string;
  step: number;
  label: string;
  labelVi: string;
  description: string;
  descriptionVi: string;
  txHash: Hash;
  status: 'success' | 'reverted';
  revertReason?: string;
  blockNumber: number;
  gasUsed: string;
  effectiveGasPriceGwei?: string;
  from?: string;
  to?: string;
  outflow: string;
  outflowVi: string;
  snowtraceUrl: string;
}

export const FALLBACK_TWIN_EVIDENCE = {
  contractAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
  chainId: 43113,
  mode: 'broadcast',
  controlledVendorAddress: '0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA',
  legitPayeeAddress: '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c',
  agentAddress: '0x374b8A126FDb9e5deEc8307da385076155Af3D72',
  ownerAddress: '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c',
  missionA: {
    txHash: '0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6',
    blockNumber: 61001944,
  },
  missionB: {
    negativeControl: {
      txHash: '0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38',
      blockNumber: 61001947,
    },
    positiveControl: {
      txHash: '0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315',
      blockNumber: 61001949,
    },
  },
};

export function getTwinLiveEvidence(): any {
  const possiblePaths = [
    path.resolve(process.cwd(), '../evidence/twin/twin.live.json'),
    path.resolve(process.cwd(), '../../evidence/twin/twin.live.json'),
    path.resolve(process.cwd(), 'evidence/twin/twin.live.json'),
    path.resolve(__dirname, '../../../evidence/twin/twin.live.json'),
    path.resolve(__dirname, '../../evidence/twin/twin.live.json'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {}
    }
  }
  return FALLBACK_TWIN_EVIDENCE;
}


// Measured USDC outflow from the treasury, read from the receipt's Transfer logs (never typed in).
const FUJI_USDC = '0x5425890298aed601595a70ab815c96711a31bc65';
const TREASURY = '0x20451c1e2dcd83f166b4f22868badecb5868d545';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export function measuredOutflowAtomic(receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] }): bigint {
  let total = 0n;
  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== FUJI_USDC || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const from = '0x' + (log.topics[1] || '').slice(26).toLowerCase();
    if (from === TREASURY) total += BigInt(log.data);
  }
  return total;
}
function outflowLabel(atomic: bigint, en: string, vi: string): { outflow: string; outflowVi: string } {
  const usdc = atomic === 0n ? '0' : `-${formatUnits(atomic, 6)}`;
  return { outflow: `${usdc} USDC (${en})`, outflowVi: `${usdc} USDC (${vi})` };
}

export async function fetchLiveReceipts(
  client?: PublicClient,
  overrideEvidence?: any
): Promise<JudgeReceiptItem[]> {
  const evidence = overrideEvidence || getTwinLiveEvidence();
  if (!evidence) {
    throw new Error('Twin live evidence not found at evidence/twin/twin.live.json');
  }

  const fujiRpc =
    process.env.AVALANCHE_FUJI_RPC_URL ||
    process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL ||
    'https://api.avax-test.network/ext/bc/C/rpc';

  const publicClient =
    client ||
    createPublicClient({
      chain: avalancheFuji,
      transport: http(fujiRpc),
    });

  const txA1Hash: Hash =
    evidence.missionA?.txHash || evidence.step4_global_allowlist_attack?.txHash;
  const txB1Hash: Hash =
    evidence.missionB?.negativeControl?.txHash ||
    evidence.step7_mission_guard_attack_revert?.txHash;
  const txB2Hash: Hash =
    evidence.missionB?.positiveControl?.txHash ||
    evidence.step8_mission_guard_legitimate_success?.txHash;

  const results: JudgeReceiptItem[] = [];

  // Tx A1: Global Allowlist mission pays the vendor (amount measured from logs)
  if (txA1Hash) {
    const rA1 = await publicClient.getTransactionReceipt({ hash: txA1Hash });
    results.push({
      id: 'missionA',
      step: 6,
      label: 'Twin A (Global Allowlist)',
      labelVi: 'Twin A (Danh sách toàn cục)',
      description: 'Poisoned invoice paid an allowlisted vendor outside the mission',
      descriptionVi: 'Hoá đơn bị cài lệnh trả cho vendor có trong allowlist chung, ngoài mission',
      txHash: txA1Hash,
      status: rA1.status === 'success' ? 'success' : 'reverted',
      blockNumber: Number(rA1.blockNumber),
      gasUsed: rA1.gasUsed.toString(),
      effectiveGasPriceGwei: rA1.effectiveGasPrice
        ? formatUnits(rA1.effectiveGasPrice, 9)
        : undefined,
      from: rA1.from,
      to: rA1.to ?? undefined,
      ...outflowLabel(measuredOutflowAtomic(rA1), 'DRAINED', 'BỊ RÚT'),
      snowtraceUrl: `https://testnet.snowtrace.io/tx/${txA1Hash}`,
    });
  }

  // Tx B1: Guarded Treasury Attack Reverted ($0.00 Lost)
  if (txB1Hash) {
    const rB1 = await publicClient.getTransactionReceipt({ hash: txB1Hash });
    results.push({
      id: 'missionB_negative',
      step: 7,
      label: 'Twin B (Guarded Treasury: Attack Revert)',
      labelVi: 'Twin B (Kho quỹ có bảo vệ: Kháng cự tấn công)',
      description: 'Execution strictly reverted on-chain with PayeeNotInMissionSet',
      descriptionVi: 'Giao dịch bị Revert on-chain với lỗi PayeeNotInMissionSet',
      txHash: txB1Hash,
      status: rB1.status === 'success' ? 'success' : 'reverted',
      revertReason: rB1.status === 'reverted' ? 'PayeeNotInMissionSet' : undefined,
      blockNumber: Number(rB1.blockNumber),
      gasUsed: rB1.gasUsed.toString(),
      effectiveGasPriceGwei: rB1.effectiveGasPrice
        ? formatUnits(rB1.effectiveGasPrice, 9)
        : undefined,
      from: rB1.from,
      to: rB1.to ?? undefined,
      ...outflowLabel(measuredOutflowAtomic(rB1), 'PROTECTED', 'ĐƯỢC BẢO VỆ'),
      snowtraceUrl: `https://testnet.snowtrace.io/tx/${txB1Hash}`,
    });
  }

  // Tx B2: Guarded Treasury Legitimate Payout ($0.01)
  if (txB2Hash) {
    const rB2 = await publicClient.getTransactionReceipt({ hash: txB2Hash });
    results.push({
      id: 'missionB_positive',
      step: 8,
      label: 'Twin B (Guarded Treasury: Legitimate Payout)',
      labelVi: 'Twin B (Kho quỹ có bảo vệ: Chi trả hợp lệ)',
      description: 'Legitimate payee with Merkle proof succeeded ($0.01 USDC paid)',
      descriptionVi: 'Người thụ hưởng hợp lệ với Merkle proof thành công',
      txHash: txB2Hash,
      status: rB2.status === 'success' ? 'success' : 'reverted',
      blockNumber: Number(rB2.blockNumber),
      gasUsed: rB2.gasUsed.toString(),
      effectiveGasPriceGwei: rB2.effectiveGasPrice
        ? formatUnits(rB2.effectiveGasPrice, 9)
        : undefined,
      from: rB2.from,
      to: rB2.to ?? undefined,
      ...outflowLabel(measuredOutflowAtomic(rB2), 'AUTHORIZED', 'ĐÃ PHÊ DUYỆT'),
      snowtraceUrl: `https://testnet.snowtrace.io/tx/${txB2Hash}`,
    });
  }

  return results;
}

// ============================================================================
// SIMULATION SERVICE
// ============================================================================

export const GUARDED_TREASURY_ADDRESS: Address =
  '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';
export const AGENT_ADDRESS: Address =
  '0x374b8A126FDb9e5deEc8307da385076155Af3D72';
export const OWNER_ADDRESS: Address =
  '0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c';
export const MISSION_B_ID: Hex =
  '0x7477696e2e6d697373696f6e2e76310000000000000000000000000000000000';

export const SIMULATE_ABI = [
  parseAbiItem(
    'function proposeWithProof(bytes32 operationId, address to, uint256 amount, bytes32 missionId, string reason, bytes32[] proof) external returns (uint256)'
  ),
  parseAbiItem(
    'function missions(bytes32) view returns (bytes32, address, uint256, uint256, bool)'
  ),
];

// In-memory sliding window rate limiter: 10 requests / minute / IP
const ipSimulateTimestamps = new Map<string, number[]>();

export function checkSimulateRateLimit(ip: string, maxPerMin = 10): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const existing = (ipSimulateTimestamps.get(ip) || []).filter((t) => t > windowStart);

  if (existing.length >= maxPerMin) {
    return false;
  }

  existing.push(now);
  ipSimulateTimestamps.set(ip, existing);
  return true;
}

export function clearSimulateRateLimit(): void {
  ipSimulateTimestamps.clear();
}

export interface SimulateResult {
  success: boolean;
  outcome: 'REVERT' | 'SUCCESS' | 'RPC_ERROR' | 'INVALID_INPUT';
  revertReason?: string;
  recipient: Address;
  amountAtomic: number;
  amountUsdc: string;
  agentAddress: Address;
  treasuryAddress: Address;
  missionId: Hex;
  isOwnerPositiveControl: boolean;
  castCommand: string;
  missionBExpiry: string | null;
  details: string;
  detailsVi: string;
}

export function classifyError(err: any): { isRevert: boolean; reason: string } {
  let isContractRevert = false;
  let reason = '';

  if (err && typeof err.walk === 'function') {
    const walked = err.walk((e: any) => {
      const name = e?.name || '';
      const msg = e?.message || '';
      return (
        name.includes('ContractFunctionRevertedError') ||
        name.includes('CallExecutionError') ||
        msg.includes('execution reverted')
      );
    });
    if (walked) {
      isContractRevert = true;
    }
  }

  const rawMessage = (err?.message || err?.shortMessage || String(err)).toLowerCase();
  if (
    rawMessage.includes('execution reverted') ||
    rawMessage.includes('reverted with the following reason') ||
    rawMessage.includes('payeenotinmissionset') ||
    rawMessage.includes('custom error') ||
    rawMessage.includes('contractfunctionrevertederror')
  ) {
    isContractRevert = true;
  }

  // Report the reason the contract actually gave; never default to PayeeNotInMissionSet.
  const original = err?.shortMessage || err?.message || String(err);
  const m =
    original.match(/reverted with the following reason:\s*([^\n]+)/i) ||
    original.match(/reason:\s*([A-Za-z0-9_]+)/i) ||
    original.match(/execution reverted:\s*([^\n]+)/i);
  if (m && m[1].trim()) {
    reason = m[1].trim();
  } else if (rawMessage.includes('payeenotinmissionset')) {
    reason = 'PayeeNotInMissionSet';
  } else {
    reason = 'ExecutionReverted (reason not decoded)';
  }

  return { isRevert: isContractRevert, reason };
}

export async function runJudgeSimulation(
  targetRecipient: string,
  amountAtomic = 10000,
  client?: PublicClient
): Promise<SimulateResult> {
  const trimmed = targetRecipient.trim();
  if (!isAddress(trimmed, { strict: false })) {
    throw new Error('INVALID_ADDRESS');
  }

  if (amountAtomic <= 0 || amountAtomic > 10000) {
    throw new Error('INVALID_AMOUNT');
  }

  const recipient = getAddress(trimmed);
  const isOwnerPositiveControl = recipient.toLowerCase() === OWNER_ADDRESS.toLowerCase();

  const fujiRpc =
    process.env.AVALANCHE_FUJI_RPC_URL ||
    process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL ||
    'https://api.avax-test.network/ext/bc/C/rpc';

  const publicClient =
    client ||
    createPublicClient({
      chain: avalancheFuji,
      transport: http(fujiRpc),
    });

  let missionBExpiryDate: string | null = null;
  try {
    const missionData = (await publicClient.readContract({
      address: GUARDED_TREASURY_ADDRESS,
      abi: SIMULATE_ABI,
      functionName: 'missions',
      args: [MISSION_B_ID],
    })) as [Hex, Address, bigint, bigint, boolean];

    if (missionData && missionData[3]) {
      const expirySec = Number(missionData[3]);
      if (expirySec > 0) {
        missionBExpiryDate = new Date(expirySec * 1000).toISOString();
      }
    }
  } catch (err: any) {
    if (client) {
      // In mocked or specific unit test environments, rethrow if intended
      const msg = err?.message || '';
      if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED')) {
        const rpcErr = new Error(`RPC_ERROR: ${msg}`);
        (rpcErr as any).isRpcError = true;
        throw rpcErr;
      }
    }
  }

  const operationId = keccak256(toHex(`judge.sim.${Date.now()}.${Math.random()}`));
  const reason = isOwnerPositiveControl
    ? 'Legitimate vendor settlement (Judge Mode Positive Control)'
    : 'Arbitrary payout attempt (Judge Mode Simulation)';
  const proof: Hex[] = [];

  const callData = encodeFunctionData({
    abi: SIMULATE_ABI,
    functionName: 'proposeWithProof',
    args: [operationId, recipient, BigInt(amountAtomic), MISSION_B_ID, reason, proof],
  });

  const castCommand = `cast call ${GUARDED_TREASURY_ADDRESS} "proposeWithProof(bytes32,address,uint256,bytes32,string,bytes32[])(uint256)" ${operationId} ${recipient} ${amountAtomic} ${MISSION_B_ID} "${reason}" "[]" --from ${AGENT_ADDRESS} --rpc-url ${fujiRpc}`;

  try {
    await publicClient.call({
      account: AGENT_ADDRESS,
      to: GUARDED_TREASURY_ADDRESS,
      data: callData,
    });

    return {
      success: true,
      outcome: 'SUCCESS',
      recipient,
      amountAtomic,
      amountUsdc: '0.010000 USDC',
      agentAddress: AGENT_ADDRESS,
      treasuryAddress: GUARDED_TREASURY_ADDRESS,
      missionId: MISSION_B_ID,
      isOwnerPositiveControl,
      castCommand,
      missionBExpiry: missionBExpiryDate,
      details: 'Simulation succeeded (proposal accepted by GuardedTreasury).',
      detailsVi: 'Mô phỏng thành công (được chấp thuận bởi GuardedTreasury).',
    };
  } catch (err: any) {
    const { isRevert, reason: revertReason } = classifyError(err);

    if (isRevert) {
      return {
        success: false,
        outcome: 'REVERT',
        revertReason,
        recipient,
        amountAtomic,
        amountUsdc: '0.010000 USDC',
        agentAddress: AGENT_ADDRESS,
        treasuryAddress: GUARDED_TREASURY_ADDRESS,
        missionId: MISSION_B_ID,
        isOwnerPositiveControl,
        castCommand,
        missionBExpiry: missionBExpiryDate,
        details: `GuardedTreasury strictly rejected proposal on-chain: ${revertReason}`,
        detailsVi: `Hợp đồng GuardedTreasury đã chặn và Revert trên chuỗi với lỗi: ${revertReason}`,
      };
    }

    const rpcErr = new Error(`RPC_ERROR: ${err?.message || 'RPC communication failure'}`);
    (rpcErr as any).isRpcError = true;
    throw rpcErr;
  }
}
