import { NextResponse } from 'next/server';
import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits,
} from 'viem';
import { avalancheFuji } from 'viem/chains';

const FUJI_USDC_ADDRESS = '0x5425890298aed601595a70AB815c96711a31Bc65' as const;
const GUARDED_TREASURY_ADDRESS = '0x20451c1e2dCD83F166B4f22868BAdECb5868d545' as const;
const SESSION_WALLET_ADDRESS = '0x46a84a9f976587c4a169b596f2a8779919f41b31' as const;
const ATTACKER_ADDRESS = '0x3333333333333333333333333333333333333333' as const;

const erc20Abi = [
  parseAbiItem('function balanceOf(address account) view returns (uint256)'),
];

export async function GET() {
  try {
    const rpcUrl = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
    const publicClient = createPublicClient({
      chain: avalancheFuji,
      transport: http(rpcUrl),
    });

    const [blockNumber, treasuryBal, sessionBal, attackerBal] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.readContract({
        address: FUJI_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [GUARDED_TREASURY_ADDRESS],
      }),
      publicClient.readContract({
        address: FUJI_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [SESSION_WALLET_ADDRESS],
      }),
      publicClient.readContract({
        address: FUJI_USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ATTACKER_ADDRESS],
      }),
    ]);

    return NextResponse.json({
      success: true,
      mode: 'LIVE_FUJI',
      blockNumber: blockNumber.toString(),
      balances: {
        treasuryUsdc: formatUnits(treasuryBal, 6),
        sessionWalletUsdc: formatUnits(sessionBal, 6),
        attackerUsdc: formatUnits(attackerBal, 6),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Arena balances error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'RPC lỗi',
        mode: 'RPC_ERROR',
        balances: null,
      },
      { status: 503 }
    );
  }
}
