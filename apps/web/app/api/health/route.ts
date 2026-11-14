import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createPublicClient, http } from 'viem';
import { avalancheFuji } from 'viem/chains';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const FUJI_RPC_URL = process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
const GUARDED_TREASURY_ADDRESS =
  process.env.GUARDED_TREASURY_ADDRESS ||
  process.env.NEXT_PUBLIC_GUARDED_TREASURY_ADDRESS ||
  '0x20451c1e2dCD83F166B4f22868BAdECb5868d545';

export async function GET() {
  const timestamp = new Date().toISOString();
  let dbStatus = 'disconnected';
  let chainStatus = 'disconnected';
  let chainId = 0;
  let latestBlock = 0;
  let rpcLatencyMs = 0;

  // 1. Check Database Connectivity
  try {
    await prisma.$queryRaw`SELECT 1 as healthy`;
    dbStatus = 'connected';
  } catch (err: any) {
    dbStatus = `error: ${err?.message || 'DB query failed'}`;
  }

  // 2. Check Avalanche Fuji RPC Connectivity & Invariants
  try {
    const client = createPublicClient({
      chain: avalancheFuji,
      transport: http(FUJI_RPC_URL),
    });

    const start = Date.now();
    chainId = await client.getChainId();
    const blockNum = await client.getBlockNumber();
    latestBlock = Number(blockNum);
    rpcLatencyMs = Date.now() - start;
    chainStatus = chainId === 43113 ? 'connected' : 'wrong_chain';
  } catch (err: any) {
    chainStatus = `error: ${err?.message || 'RPC query failed'}`;
  }

  const isHealthy = dbStatus === 'connected' && chainStatus === 'connected' && chainId === 43113;

  const payload = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp,
    network: {
      name: 'Avalanche Fuji Testnet',
      expectedChainId: 43113,
      actualChainId: chainId,
      latestBlock,
      treasuryAddress: GUARDED_TREASURY_ADDRESS,
      rpcLatencyMs,
      status: chainStatus,
    },
    database: {
      status: dbStatus,
    },
    version: '1.0.0',
    deploymentMode: process.env.PAYMENT_MODE || 'LIVE_FUJI',
  };

  return NextResponse.json(payload, {
    status: isHealthy ? 200 : 503,
  });
}
