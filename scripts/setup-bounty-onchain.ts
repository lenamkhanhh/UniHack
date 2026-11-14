/**
 * On-chain Fuji Setup for WOW-W3: "Hack the Treasury" Public Bounty Challenge.
 *
 * Spec:
 * - Mission: keccak256("missionpay-bounty-v1")
 * - Cap: 5 USDC (5_000_000n)
 * - Payee root: 2 fixed legitimate vendors (0x1111... and 0x2222...)
 * - Expires: 2026-12-20T00:00:00Z
 * - Funds treasury: transfers 5 USDC from owner to GuardedTreasury
 * - Updates local PostgreSQL DB and FUJI_EVIDENCE.md
 */

import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  toHex,
  formatUnits,
  Hex,
} from 'viem';
import { avalancheFuji } from 'viem/chains';
import {
  FUJI_RPC_URL,
  FUJI_USDC_ADDRESS,
  getOwnerAccount,
} from './owner-sign';
import { computePayeeMerkleTree } from '../apps/web/lib/merkle';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const GUARDED_TREASURY_ADDRESS = '0x20451c1e2dCD83F166B4f22868BAdECb5868d545' as const;
const AGENT_ADDRESS = '0x374b8A126FDb9e5deEc8307da385076155Af3D72' as const;

const TREASURY_ABI = parseAbi([
  'function createMission(bytes32 missionId, address agent, uint256 cap, uint256 duration) external',
  'function setMissionPayeeRoot(bytes32 missionId, bytes32 root) external',
  'function setRecipient(address r, bool allowed) external',
  'function recipientAllowlist(address) view returns (bool)',
  'function missions(bytes32) view returns (bytes32, address, uint256, uint256, bool, bool)',
  'function missionPayeeRoot(bytes32) view returns (bytes32)',
]);

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

async function main() {
  console.log('[Bounty Setup] Initializing WOW-W3 Bounty on Avalanche Fuji...');

  const ownerAccount = getOwnerAccount();
  console.log(`[Bounty Setup] Owner Address: ${ownerAccount.address}`);

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const walletClient = createWalletClient({
    account: ownerAccount,
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const missionSlug = 'missionpay-bounty-v1';
  const missionId = keccak256(toHex(missionSlug));
  console.log(`[Bounty Setup] Mission Slug: ${missionSlug}`);
  console.log(`[Bounty Setup] Mission ID:   ${missionId}`);

  const payees = [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
  ];
  const treeResult = computePayeeMerkleTree(payees);
  console.log(`[Bounty Setup] Payees Merkle Root: ${treeResult.root}`);

  const cap = 5_000_000n; // 5 USDC
  const targetExpiry = Math.floor(new Date('2026-12-20T00:00:00Z').getTime() / 1000);
  const block = await publicClient.getBlock();
  const currentTimestamp = Number(block.timestamp);
  const duration = BigInt(Math.max(86400, targetExpiry - currentTimestamp));
  console.log(`[Bounty Setup] Duration: ${duration} seconds (target expiry: 2026-12-20 UTC)`);

  // 1. Ensure recipients are allowlisted
  for (const payee of payees) {
    const isAllowlisted = await publicClient.readContract({
      address: GUARDED_TREASURY_ADDRESS,
      abi: TREASURY_ABI,
      functionName: 'recipientAllowlist',
      args: [payee as `0x${string}`],
    });
    if (!isAllowlisted) {
      console.log(`[Bounty Setup] Allowlisting ${payee}...`);
      const allowTx = await walletClient.writeContract({
        address: GUARDED_TREASURY_ADDRESS,
        abi: TREASURY_ABI,
        functionName: 'setRecipient',
        args: [payee as `0x${string}`, true],
      });
      console.log(`  Tx: ${allowTx}`);
      await publicClient.waitForTransactionReceipt({ hash: allowTx });
    }
  }

  // 2. Check if mission exists, create if not
  const existingMission = await publicClient.readContract({
    address: GUARDED_TREASURY_ADDRESS,
    abi: TREASURY_ABI,
    functionName: 'missions',
    args: [missionId],
  });

  let createTxHash = '';
  if (!existingMission[4]) { // exists == false
    console.log('[Bounty Setup] Creating mission on GuardedTreasury...');
    const createTx = await walletClient.writeContract({
      address: GUARDED_TREASURY_ADDRESS,
      abi: TREASURY_ABI,
      functionName: 'createMission',
      args: [missionId, AGENT_ADDRESS, cap, duration],
    });
    console.log(`  createMission Tx: ${createTx}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
    console.log(`  Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`);
    createTxHash = createTx;
  } else {
    console.log('[Bounty Setup] Mission already exists on-chain.');
  }

  // 3. Set payee root
  const currentRoot = await publicClient.readContract({
    address: GUARDED_TREASURY_ADDRESS,
    abi: TREASURY_ABI,
    functionName: 'missionPayeeRoot',
    args: [missionId],
  });

  let setRootTxHash = '';
  if (currentRoot.toLowerCase() !== treeResult.root.toLowerCase()) {
    console.log('[Bounty Setup] Setting mission payee root on GuardedTreasury...');
    const rootTx = await walletClient.writeContract({
      address: GUARDED_TREASURY_ADDRESS,
      abi: TREASURY_ABI,
      functionName: 'setMissionPayeeRoot',
      args: [missionId, treeResult.root],
    });
    console.log(`  setMissionPayeeRoot Tx: ${rootTx}`);
    const rootReceipt = await publicClient.waitForTransactionReceipt({ hash: rootTx });
    console.log(`  Confirmed in block ${rootReceipt.blockNumber}, status: ${rootReceipt.status}`);
    setRootTxHash = rootTx;
  } else {
    console.log('[Bounty Setup] Payee root already committed on-chain.');
  }

  // 4. Fund Treasury with 5 USDC from Owner
  console.log('[Bounty Setup] Transferring 5 USDC to GuardedTreasury...');
  const fundTx = await walletClient.writeContract({
    address: FUJI_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [GUARDED_TREASURY_ADDRESS, cap],
  });
  console.log(`  USDC Transfer Tx: ${fundTx}`);
  const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundTx });
  console.log(`  Confirmed in block ${fundReceipt.blockNumber}, status: ${fundReceipt.status}`);

  const treasuryBal = await publicClient.readContract({
    address: FUJI_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [GUARDED_TREASURY_ADDRESS],
  });
  console.log(`[Bounty Setup] Current Treasury Balance: ${formatUnits(treasuryBal, 6)} USDC`);

  // 5. Upsert Mission in local PostgreSQL DB
  const policyHash = keccak256(toHex(`policy-bounty-v1-${treeResult.root}`));
  await prisma.mission.upsert({
    where: { slug: missionSlug },
    update: {
      missionId,
      ownerAddress: ownerAccount.address,
      agentAddress: AGENT_ADDRESS,
      treasuryCap: '5000000',
      toolCap: '0',
      expiresAt: new Date(targetExpiry * 1000),
      status: 'ACTIVE',
      payeesJson: JSON.stringify(payees),
      payeeRoot: treeResult.root,
      policyHash,
      publicPublished: true,
    },
    create: {
      slug: missionSlug,
      missionId,
      ownerAddress: ownerAccount.address,
      agentAddress: AGENT_ADDRESS,
      treasuryCap: '5000000',
      toolCap: '0',
      expiresAt: new Date(targetExpiry * 1000),
      status: 'ACTIVE',
      payeesJson: JSON.stringify(payees),
      payeeRoot: treeResult.root,
      policyHash,
      publicPublished: true,
    },
  });
  console.log(`[Bounty Setup] Upserted mission ${missionSlug} in local database.`);

  // 6. Update FUJI_EVIDENCE.md
  const evidencePath = path.resolve(__dirname, '../artifacts/submission-s1/FUJI_EVIDENCE.md');
  if (fs.existsSync(evidencePath)) {
    let evidence = fs.readFileSync(evidencePath, 'utf8');
    const bountyEntry = `
### W3 Bounty Setup: "Hack the Treasury" (Mission \`${missionSlug}\`)
- **Mission ID:** \`${missionId}\`
- **Guarded Treasury:** \`${GUARDED_TREASURY_ADDRESS}\`
- **Target Cap:** 5.00 USDC (\`5000000\` atomic)
- **Authorized Payee Set:** \`0x1111...1111\`, \`0x2222...2222\` (Root: \`${treeResult.root}\`)
- **Expiry:** 2026-12-20 UTC
- **Transactions:**
  - \`createMission\`: ${createTxHash ? `[\`${createTxHash}\`](https://testnet.snowtrace.io/tx/${createTxHash})` : 'Pre-existing or confirmed'}
  - \`setMissionPayeeRoot\`: ${setRootTxHash ? `[\`${setRootTxHash}\`](https://testnet.snowtrace.io/tx/${setRootTxHash})` : 'Committed'}
  - \`fundTreasury\` (5 USDC): [\`${fundTx}\`](https://testnet.snowtrace.io/tx/${fundTx})
`;
    if (!evidence.includes(missionSlug)) {
      evidence += '\n' + bountyEntry;
      fs.writeFileSync(evidencePath, evidence, 'utf8');
      console.log('[Bounty Setup] Appended bounty evidence to FUJI_EVIDENCE.md');
    }
  }

  console.log('[Bounty Setup COMPLETE] MissionPay Bounty is live on Fuji.');
}

main()
  .catch((err) => {
    console.error('[Bounty Setup Error]', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
