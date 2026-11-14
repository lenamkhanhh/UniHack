import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  CHAIN_ID,
  USDC_ADDRESS,
  PER_TX_TREASURY_CAP,
  UTC_DAILY_TREASURY_CAP,
  SEARCH_PRICE,
  SUMMARY_PRICE,
  TALKMETER_PRICE_PER_MINUTE,
} from '@/lib/constants';
import {
  getPaymentMode,
  getConfiguredOwner,
  getDeploymentId,
  getConfiguredAgentPrivateKey,
} from '@/lib/config';
import { privateKeyToAccount } from 'viem/accounts';

export async function GET() {
  try {
    const state = await prisma.systemState.findUnique({ where: { id: 1 } });
    const isS1 = !state || state.stage === 'S1';

    let configuredOwner: string | null = null;
    try {
      configuredOwner = getConfiguredOwner();
    } catch {
      configuredOwner = null;
    }

    let deploymentId: string | null = state?.deploymentId || null;
    if (!deploymentId) {
      try {
        deploymentId = getDeploymentId();
      } catch {
        deploymentId = null;
      }
    }

    let paymentMode: 'MOCK' | 'LIVE_FUJI' = 'MOCK';
    try {
      paymentMode = getPaymentMode();
    } catch {
      paymentMode = 'MOCK';
    }

    let agentAddress: string | null = null;
    try {
      const agentKey = getConfiguredAgentPrivateKey();
      if (agentKey) {
        agentAddress = privateKeyToAccount(agentKey).address;
      }
    } catch {
      agentAddress = null;
    }

    return NextResponse.json({
      stage: isS1 ? 'S1' : 'S2',
      chainId: CHAIN_ID,
      paymentMode,
      configuredOwner,
      deploymentId,
      agentAddress,
      asset: USDC_ADDRESS,
      systemPaused: state?.systemPaused ?? false,
      maintenance: state?.maintenance ?? false,
      guardAddress: isS1 ? null : state?.guardAddress,
      perTxTreasuryCap: isS1 ? null : PER_TX_TREASURY_CAP.toString(),
      utcDailyTreasuryCap: isS1 ? null : UTC_DAILY_TREASURY_CAP.toString(),
      tools: {
        'tool:search': { priceAtomic: SEARCH_PRICE.toString() },
        'tool:summary': { priceAtomic: SUMMARY_PRICE.toString() },
        'tool:talkmeter': { priceAtomic: TALKMETER_PRICE_PER_MINUTE.toString() },
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
