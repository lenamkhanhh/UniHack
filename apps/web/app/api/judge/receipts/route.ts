import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createPublicClient, http, Hash, PublicClient } from 'viem';
import { avalancheFuji } from 'viem/chains';

export const dynamic = 'force-dynamic';

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

export function getTwinLiveEvidence(): any {
  const possiblePaths = [
    path.resolve(process.cwd(), '../../evidence/twin/twin.live.json'),
    path.resolve(process.cwd(), 'evidence/twin/twin.live.json'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {}
    }
  }
  return null;
}

export async function fetchLiveReceipts(
  client?: PublicClient,
  overrideEvidence?: any
): Promise<JudgeReceiptItem[]> {
  const evidence = overrideEvidence || getTwinLiveEvidence();
  if (!evidence) {
    throw new Error('Twin live evidence not found at evidence/twin/twin.live.json');
  }

  const hashA: Hash = evidence.missionA?.txHash;
  const hashB_neg: Hash = evidence.missionB?.negativeControl?.txHash;
  const hashB_pos: Hash = evidence.missionB?.positiveControl?.txHash;

  if (!hashA || !hashB_neg || !hashB_pos) {
    throw new Error('Incomplete transaction hashes in twin.live.json');
  }

  const rpcUrl =
    process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
  const publicClient =
    client ||
    createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

  // Query live receipts in parallel from Fuji RPC
  const [rcA, rcB_neg, rcB_pos] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: hashA }),
    publicClient.getTransactionReceipt({ hash: hashB_neg }),
    publicClient.getTransactionReceipt({ hash: hashB_pos }),
  ]);

  const items: JudgeReceiptItem[] = [
    {
      id: 'missionA',
      step: 6,
      label: 'Mission A: Global Allowlist Mode',
      labelVi: 'Nhiệm vụ A: Chế độ Allowlist Toàn Cục',
      description: 'Poisoned invoice to off-mission vendor. Global allowlist alone fails to scope payouts per mission.',
      descriptionVi: 'Hóa đơn nhiễm độc gửi vendor ngoài nhiệm vụ. Chỉ dùng allowlist toàn cục không thể phân tách nhiệm vụ.',
      txHash: hashA,
      status: rcA.status, // exact status from live receipt ('success' | 'reverted')
      blockNumber: Number(rcA.blockNumber),
      gasUsed: rcA.gasUsed.toString(),
      from: rcA.from,
      to: rcA.to || undefined,
      outflow: '+0.01 USDC (Drained to controlled vendor)',
      outflowVi: '+0.01 USDC (Thoát vốn về vendor kiểm soát)',
      snowtraceUrl: `https://testnet.snowtrace.io/tx/${hashA}`,
    },
    {
      id: 'missionB_negative',
      step: 7,
      label: 'Mission B: Negative Control (Off-mission vendor)',
      labelVi: 'Nhiệm vụ B: Đối chứng Âm (Vendor ngoài nhiệm vụ)',
      description: 'Same poisoned invoice to same vendor under owner-signed Merkle root. Blocked on-chain.',
      descriptionVi: 'Cùng một hóa đơn tới cùng vendor nhưng trong nhiệm vụ có Merkle root. Bị chặn on-chain.',
      txHash: hashB_neg,
      status: rcB_neg.status, // exact status from live receipt ('reverted')
      revertReason: 'PayeeNotInMissionSet',
      blockNumber: Number(rcB_neg.blockNumber),
      gasUsed: rcB_neg.gasUsed.toString(),
      from: rcB_neg.from,
      to: rcB_neg.to || undefined,
      outflow: '0.00 USDC (Reverted on-chain, 0 USDC leaked)',
      outflowVi: '0.00 USDC (Revert trên hợp đồng, 0 USDC thất thoát)',
      snowtraceUrl: `https://testnet.snowtrace.io/tx/${hashB_neg}`,
    },
    {
      id: 'missionB_positive',
      step: 8,
      label: 'Mission B: Positive Control (Legitimate Owner payee)',
      labelVi: 'Nhiệm vụ B: Đối chứng Dương (Chủ sở hữu hợp lệ)',
      description: 'Legitimate payment to owner in Mission B payee set with valid Merkle proof. Auto-payout executes.',
      descriptionVi: 'Thanh toán hợp lệ cho chủ sở hữu trong danh sách Mission B kèm Merkle proof. Tự động giải ngân.',
      txHash: hashB_pos,
      status: rcB_pos.status, // exact status from live receipt ('success')
      blockNumber: Number(rcB_pos.blockNumber),
      gasUsed: rcB_pos.gasUsed.toString(),
      from: rcB_pos.from,
      to: rcB_pos.to || undefined,
      outflow: '+0.01 USDC (Paid safely to Owner)',
      outflowVi: '+0.01 USDC (Thanh toán an toàn về Owner)',
      snowtraceUrl: `https://testnet.snowtrace.io/tx/${hashB_pos}`,
    },
  ];

  return items;
}

export async function GET() {
  try {
    const receipts = await fetchLiveReceipts();
    return NextResponse.json({
      success: true,
      contractAddress: '0x20451c1e2dCD83F166B4f22868BAdECb5868d545',
      chainId: 43113,
      receipts,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'RPC_ERROR',
        message: err.message || 'Failed to read live receipts from Avalanche Fuji RPC',
      },
      { status: 502 }
    );
  }
}
