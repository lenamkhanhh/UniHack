import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import fs from 'fs';
import path from 'path';

try {
  process.loadEnvFile(path.resolve(__dirname, '../apps/web/.env'));
} catch {}

const client = createPublicClient({
  chain: avalancheFuji,
  transport: http('https://api.avax-test.network/ext/bc/C/rpc'),
});

const txs = [
  { name: 'proposeWithProof', hash: '0x769484bb45b13a42917972dabb206697ec4f21acd117394017a62e0046cd6c9a' },
  { name: 'x402_settlement', hash: '0x8c898c904fef42c9a2e5d45b18549bd48dce285ef81d497f588ae41320dc8208' },
  { name: 'proof_anchor', hash: '0x43bd21b81248a9f1a4dc2ff037a3df8119ae098690cd4e353bdbb4ce6ceb0547' },
  { name: 'passkey_approveMission', hash: '0x9885664fcfc45539af1183fa3768f6e2dbfb52c76544b7b6f1ee14833790cf45' },
  // W6-F3: Updated validationResponse tx from W2-F1
  { name: 'erc8004_validationResponse', hash: '0xb641353c51d0f44192bcbf40743c20940b88a83c52a2c41f5852aea1ebe4d059' },
];

async function measureFinality(): Promise<{ samplesMs: number[]; medianMs: number } | null> {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!relayerKey) {
    console.log('No RELAYER_PRIVATE_KEY found, skipping live finality measurement');
    return null;
  }

  const account = privateKeyToAccount(relayerKey.startsWith('0x') ? relayerKey as `0x${string}` : `0x${relayerKey}`);
  const wallet = createWalletClient({
    account,
    chain: avalancheFuji,
    transport: http('https://api.avax-test.network/ext/bc/C/rpc'),
  });

  const samples: number[] = [];
  console.log(`Measuring real Avalanche Fuji finality with 3 zero-value txs from relayer ${account.address}...`);

  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const hash = await wallet.sendTransaction({
      to: account.address,
      value: 0n,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    const elapsed = Date.now() - t0;
    samples.push(elapsed);
    console.log(`[Sample ${i + 1}/3] Tx: ${hash.slice(0, 18)}... | Status: ${receipt.status} | Finality: ${elapsed}ms`);
  }

  samples.sort((a, b) => a - b);
  const medianMs = samples[1];
  return { samplesMs: samples, medianMs };
}

async function main() {
  const transactionResults = [];
  for (const t of txs) {
    const start = Date.now();
    const receipt = await client.getTransactionReceipt({ hash: t.hash as `0x${string}` });
    const receiptFetchMs = Date.now() - start;
    const feeWei = receipt.gasUsed * receipt.effectiveGasPrice;
    transactionResults.push({
      name: t.name,
      hash: t.hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: Number(receipt.gasUsed),
      effectiveGasPriceWei: Number(receipt.effectiveGasPrice),
      feeAvax: formatEther(feeWei),
      status: receipt.status,
      receiptFetchMs,
    });
  }

  let finalityData = null;
  try {
    finalityData = await measureFinality();
  } catch (err: any) {
    console.error('Finality measurement error:', err.message);
  }

  const outDir = path.resolve(__dirname, '../evidence');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const costData = {
    network: 'Avalanche Fuji Testnet',
    chainId: 43113,
    recordedAt: new Date().toISOString(),
    transactions: transactionResults,
    finality: finalityData
      ? {
          method: 'real sendTransaction to receipt confirmation on Fuji C-Chain',
          samplesMs: finalityData.samplesMs,
          medianMs: finalityData.medianMs,
        }
      : {
          note: 'Chưa đo finality trực tiếp trong đợt này',
        },
  };

  fs.writeFileSync(path.join(outDir, 'cost.json'), JSON.stringify(costData, null, 2));
  console.log('SUCCESS: wrote evidence/cost.json');
  console.log(JSON.stringify(costData, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
