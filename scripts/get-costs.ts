import { createPublicClient, http, formatEther } from 'viem';
import { avalancheFuji } from 'viem/chains';
import fs from 'fs';
import path from 'path';

const client = createPublicClient({
  chain: avalancheFuji,
  transport: http('https://api.avax-test.network/ext/bc/C/rpc'),
});

const txs = [
  { name: 'proposeWithProof', hash: '0x769484bb45b13a42917972dabb206697ec4f21acd117394017a62e0046cd6c9a' },
  { name: 'x402_settlement', hash: '0x8c898c904fef42c9a2e5d45b18549bd48dce285ef81d497f588ae41320dc8208' },
  { name: 'proof_anchor', hash: '0x43bd21b81248a9f1a4dc2ff037a3df8119ae098690cd4e353bdbb4ce6ceb0547' },
  { name: 'passkey_approveMission', hash: '0x9885664fcfc45539af1183fa3768f6e2dbfb52c76544b7b6f1ee14833790cf45' },
  { name: 'erc8004_validationResponse', hash: '0x62451c36b6488cf4423bd7427e560ac2e3de46144d7ba5c30d81c55df7fe1564' },
];

async function main() {
  const results = [];
  for (const t of txs) {
    const start = Date.now();
    const receipt = await client.getTransactionReceipt({ hash: t.hash as `0x${string}` });
    const latencyMs = Date.now() - start;
    const feeWei = receipt.gasUsed * receipt.effectiveGasPrice;
    results.push({
      name: t.name,
      hash: t.hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: Number(receipt.gasUsed),
      effectiveGasPriceGwei: Number(receipt.effectiveGasPrice) / 1e9,
      feeAvax: formatEther(feeWei),
      status: receipt.status,
      latencyMs,
    });
  }

  const outDir = path.resolve(__dirname, '../evidence');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const costData = {
    network: 'Avalanche Fuji Testnet',
    chainId: 43113,
    recordedAt: new Date().toISOString(),
    transactions: results,
  };

  fs.writeFileSync(path.join(outDir, 'cost.json'), JSON.stringify(costData, null, 2));
  console.log('SUCCESS: wrote evidence/cost.json');
  console.log(JSON.stringify(costData, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
