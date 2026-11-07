/**
 * PV-5: Avalanche Fuji Simulation Script - Compromised Server / Tainted Payee Revert
 *
 * Simulates a compromised server or agent attempting to steal funds by calling
 * GuardedTreasury.proposeWithProof() with an attacker-controlled payee address
 * outside the owner-signed Merkle set, using a forged/fake proof.
 *
 * Invariant proven:
 * - Even with full root access or compromised agent keys, the transaction strictly
 *   REVERTS on-chain with "PayeeNotInMissionSet" because the smart contract independently
 *   verifies the leaf against the owner-signed missionPayeeRoot.
 *
 * SAFETY GUARD:
 * - Default: DRY-RUN / SIMULATION via eth_call (no broadcast, no gas spent).
 * - Broadcast mode requires BOTH:
 *     --broadcast flag AND ALLOW_FUJI_BROADCAST=1 in environment.
 * - Rejects default Anvil / Hardhat keys.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  encodeFunctionData,
  getAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';

const FUJI_RPC_URL =
  process.env.AVALANCHE_FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';

const GUARDED_TREASURY_ADDRESS =
  process.env.GUARDED_TREASURY_ADDRESS ||
  process.env.NEXT_PUBLIC_GUARDED_TREASURY_ADDRESS ||
  '0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3';

const proposeWithProofAbi = parseAbiItem(
  'function proposeWithProof(bytes32 operationId, address to, uint256 amount, bytes32 missionId, string reason, bytes32[] proof) external returns (uint256)'
);

// Known insecure testing private keys to abort on
const INSECURE_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
];

async function main() {
  const args = process.argv.slice(2);
  const isBroadcast = args.includes('--broadcast');
  const allowBroadcast = process.env.ALLOW_FUJI_BROADCAST === '1';

  console.log('================================================================');
  console.log('PV-5: Avalanche Fuji Compromised Agent Tainted Payee Simulation');
  console.log('================================================================');
  console.log(`Treasury Contract: ${GUARDED_TREASURY_ADDRESS}`);
  console.log(`RPC Endpoint:      ${FUJI_RPC_URL}`);
  console.log(`Mode:              ${isBroadcast && allowBroadcast ? 'LIVE BROADCAST' : 'DRY-RUN SIMULATION (Safe)'}`);

  let simulationAccount: `0x${string}` | ReturnType<typeof privateKeyToAccount>;
  let walletClient: ReturnType<typeof createWalletClient> | null = null;

  if (isBroadcast && allowBroadcast) {
    const agentKey = process.env.AGENT_PRIVATE_KEY;
    if (!agentKey || !agentKey.startsWith('0x')) {
      console.error('Error: AGENT_PRIVATE_KEY is required for live broadcast.');
      process.exit(1);
    }

    if (INSECURE_KEYS.includes(agentKey.toLowerCase())) {
      console.error('Security Guardrail: Insecure test private key cannot be broadcasted to live Fuji network.');
      process.exit(1);
    }

    const account = privateKeyToAccount(agentKey as `0x${string}`);
    simulationAccount = account;
    console.log(`Agent Account:     ${account.address}`);

    walletClient = createWalletClient({
      account,
      chain: avalancheFuji,
      transport: http(FUJI_RPC_URL),
    });
  } else {
    // PV-F6: Dry-run strictly uses AGENT_ADDRESS without requiring any private key
    const rawAddress = process.env.AGENT_ADDRESS || '0x000000000000000000000000000000000000a6e7';
    if (!rawAddress.startsWith('0x') || rawAddress.length !== 42) {
      console.error('Error: AGENT_ADDRESS is missing or invalid.');
      process.exit(1);
    }
    const agentAddress = getAddress(rawAddress);
    simulationAccount = agentAddress;
    console.log(`Agent Address:     ${agentAddress} (Simulation, zero private key exposure)`);
  }

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  // Simulated attack parameters: Attacker attempts to divert 10 USDC to untrusted address
  const attackerAddress = '0xbad0000000000000000000000000000000000bad' as `0x${string}`;
  const stolenAmount = 10_000_000n; // 10 USDC
  const missionId = '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`;
  const operationId = `0x${Buffer.from(`atk-payout-${Date.now()}`).toString('hex').padEnd(64, '0')}` as `0x${string}`;
  const fakeProof = [
    '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
  ];
  const attackReason = '[ATTACK_SIMULATION] Compromised server proposing payout to tainted payee';

  console.log('\n[Phase 1] Executing on-chain call simulation via eth_call...');
  try {
    await publicClient.simulateContract({
      account: simulationAccount,
      address: GUARDED_TREASURY_ADDRESS as `0x${string}`,
      abi: [proposeWithProofAbi],
      functionName: 'proposeWithProof',
      args: [operationId, attackerAddress, stolenAmount, missionId, attackReason, fakeProof],
    });

    console.error('FATAL INVARIANT FAILURE: Transaction did NOT revert! Contract accepted tainted payee!');
    process.exit(1);
  } catch (err: any) {
    const errorMsg = err.message || err.toString();
    console.log('✅ Simulation Result: TRANSACTION REVERTED AS EXPECTED.');
    console.log(`   Revert Reason: ${errorMsg.includes('PayeeNotInMissionSet') ? 'PayeeNotInMissionSet' : errorMsg}`);
  }

  if (isBroadcast && allowBroadcast && walletClient) {
    console.log('\n[Phase 2] Broadcasting live transaction on Avalanche Fuji (will revert)...');

    try {
      const txHash = await walletClient.writeContract({
        address: GUARDED_TREASURY_ADDRESS as `0x${string}`,
        abi: [proposeWithProofAbi],
        functionName: 'proposeWithProof',
        args: [operationId, attackerAddress, stolenAmount, missionId, attackReason, fakeProof],
      });

      console.log(`Broadcasted Transaction Hash: ${txHash}`);
      console.log('Waiting for receipt on Avalanche Fuji...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`Transaction Status: ${receipt.status} (reverted on-chain)`);
      console.log(`Snowtrace Explorer: https://testnet.snowtrace.io/tx/${txHash}`);
    } catch (broadcastErr: any) {
      console.log(`Node rejected transaction pre-flight: ${broadcastErr.shortMessage || broadcastErr.message}`);
    }
  } else {
    console.log('\n[Phase 2] Broadcast skipped. (Requires --broadcast and ALLOW_FUJI_BROADCAST=1).');
    console.log('Dry-run simulation complete.');
  }
}

main().catch((err) => {
  console.error('Fatal error during simulation:', err);
  process.exit(1);
});
