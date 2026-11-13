import { NextRequest, NextResponse } from 'next/server';
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
  PublicClient,
  formatUnits,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import { resolveClientIp } from '@/lib/bounty';

export const dynamic = 'force-dynamic';

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
  outcome: 'SUCCESS' | 'REVERT';
  recipient: string;
  amountAtomic: number;
  amountUsdc: string;
  revertReason?: string;
  missionBExpiry: string;
  message: string;
}

export async function runJudgeSimulation(
  recipientRaw: string,
  amountAtomicRaw: number = 10000,
  client?: PublicClient
): Promise<SimulateResult> {
  if (
    !recipientRaw ||
    typeof recipientRaw !== 'string' ||
    !isAddress(recipientRaw.trim(), { strict: false })
  ) {
    throw new Error('INVALID_ADDRESS');
  }

  const recipient = getAddress(recipientRaw.trim());
  const amountAtomic = Number(amountAtomicRaw);

  if (!Number.isInteger(amountAtomic) || amountAtomic < 1 || amountAtomic > 10000) {
    throw new Error('INVALID_AMOUNT');
  }

  const rpcUrl =
    process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
  const publicClient =
    client ||
    createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

  // 1. Read Mission B state & expiry from live Fuji
  let missionBExpiryIso = '2026-12-13T11:44:08.000Z'; // fallback approx if read fails
  try {
    const missionBData = await publicClient.readContract({
      address: GUARDED_TREASURY_ADDRESS,
      abi: SIMULATE_ABI,
      functionName: 'missions',
      args: [MISSION_B_ID],
    });
    const expiresAtSec = Number(missionBData[3]);
    missionBExpiryIso = new Date(expiresAtSec * 1000).toISOString();
  } catch (err: any) {
    // If readContract fails completely with network error, bubble up
    if (
      err.name === 'HttpRequestError' ||
      err.message?.includes('fetch failed') ||
      err.message?.includes('ECONNREFUSED')
    ) {
      throw new Error('RPC_ERROR: Unable to reach Avalanche Fuji RPC node');
    }
  }

  // 2. Perform eth_call simulation
  const opId = keccak256(toHex(`judge_sim_${Date.now()}_${Math.random()}`)) as Hex;
  const amountUsdc = `${(amountAtomic / 1e6).toFixed(6)} USDC`;

  try {
    await publicClient.call({
      to: GUARDED_TREASURY_ADDRESS,
      account: AGENT_ADDRESS,
      data: encodeFunctionData({
        abi: SIMULATE_ABI,
        functionName: 'proposeWithProof',
        args: [
          opId,
          recipient,
          BigInt(amountAtomic),
          MISSION_B_ID,
          'judge interactive simulation',
          [], // empty proof
        ],
      }),
    });

    return {
      success: true,
      outcome: 'SUCCESS',
      recipient,
      amountAtomic,
      amountUsdc,
      missionBExpiry: missionBExpiryIso,
      message:
        'Simulation succeeded! The Fuji GuardedTreasury contract accepts this recipient under Mission B policy and would transfer funds.',
    };
  } catch (err: any) {
    // Check if network error
    if (
      err.name === 'HttpRequestError' ||
      err.message?.includes('fetch failed') ||
      err.message?.includes('ECONNREFUSED')
    ) {
      throw new Error('RPC_ERROR: Unable to reach Avalanche Fuji RPC node');
    }

    // Extract revert reason
    let revertReason =
      err.shortMessage?.match(/reason:\s*([A-Za-z0-9_]+)/)?.[1] ||
      (err.message?.includes('PayeeNotInMissionSet') ? 'PayeeNotInMissionSet' : '') ||
      (err.message?.includes('NotAllowlisted') ? 'NotAllowlisted' : '') ||
      (err.message?.includes('DailyCapExceeded') ? 'DailyCapExceeded' : '') ||
      err.shortMessage ||
      err.message ||
      'ExecutionReverted';

    if (revertReason.includes('PayeeNotInMissionSet')) {
      revertReason = 'PayeeNotInMissionSet';
    }

    return {
      success: false,
      outcome: 'REVERT',
      revertReason,
      recipient,
      amountAtomic,
      amountUsdc,
      missionBExpiry: missionBExpiryIso,
      message: `The live Fuji contract strictly rejected this payout proposal with revert reason: "${revertReason}".`,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { clientIp } = resolveClientIp(req.headers);
    const allowed = checkSimulateRateLimit(clientIp, 10);
    if (!allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'QUOTA_EXCEEDED',
          message:
            'Rate limit exceeded: maximum 10 simulations per minute per IP. Please try again in 1 minute.',
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { recipient, amountAtomic } = body;

    const result = await runJudgeSimulation(
      recipient,
      amountAtomic !== undefined ? Number(amountAtomic) : 10000
    );

    return NextResponse.json(result);
  } catch (err: any) {
    if (err.message === 'INVALID_ADDRESS') {
      return NextResponse.json(
        {
          success: false,
          error: 'BAD_REQUEST',
          message:
            'Invalid Ethereum address. Please provide a valid 20-byte address format (0x...).',
        },
        { status: 400 }
      );
    }
    if (err.message === 'INVALID_AMOUNT') {
      return NextResponse.json(
        {
          success: false,
          error: 'BAD_REQUEST',
          message:
            'Amount out of bounds: must be an integer between 1 and 10,000 atomic units (<= 0.01 USDC).',
        },
        { status: 400 }
      );
    }
    if (err.message?.startsWith('RPC_ERROR')) {
      return NextResponse.json(
        {
          success: false,
          error: 'RPC_ERROR',
          message: 'Failed to communicate with Avalanche Fuji RPC node. Please retry.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'INTERNAL_ERROR',
        message: err.message || 'Simulation unexpected error',
      },
      { status: 500 }
    );
  }
}
