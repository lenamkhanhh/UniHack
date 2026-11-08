/**
 * ERC-8004 Independent Validator Runner
 *
 * Runs verification pipeline for a mission validation bundle:
 * 1. Owner submits validationRequest on ValidationRegistry.
 * 2. Independent Validator reads blockchain state directly (ZERO application DB access).
 * 3. Validator evaluates all cryptographic criteria.
 * 4. Validator broadcasts validationResponse (score 100 on valid, 0 on invalid).
 * 5. Saves response evidence to evidence/validation/<missionId>.response.json.
 */

import fs from 'fs';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import {
  FUJI_RPC_URL,
  getOwnerAccount,
  EXPECTED_OWNER_ADDRESS,
} from './owner-sign';
import {
  computeValidationRequestHash,
  validateBundleOnChain,
  ValidationBundle,
} from '../apps/web/lib/validation-bundle';

const VALIDATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'validationRequest',
    inputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'requestURI', type: 'string' },
      { name: 'requestHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'validationResponse',
    inputs: [
      { name: 'requestHash', type: 'bytes32' },
      { name: 'response', type: 'uint8' },
      { name: 'responseURI', type: 'string' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getValidationStatus',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [
      { name: 'validatorAddress', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'response', type: 'uint8' },
      { name: 'responseHash', type: 'bytes32' },
      { name: 'tag', type: 'string' },
      { name: 'lastUpdate', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isValidationComplete',
    inputs: [{ name: 'requestHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

function getValidatorAccount() {
  const contractsEnvPath = path.resolve(__dirname, '../contracts/.env');
  const content = fs.readFileSync(contractsEnvPath, 'utf8');
  const match = content.match(/^VALIDATOR_PRIVATE_KEY\s*=\s*(0x[a-fA-F0-9]{64})/m);
  if (!match) {
    throw new Error('VALIDATOR_PRIVATE_KEY not found in contracts/.env');
  }
  return privateKeyToAccount(match[1] as Hex);
}

function getValidationRegistryAddress(): `0x${string}` {
  const contractsEnvPath = path.resolve(__dirname, '../contracts/.env');
  const content = fs.readFileSync(contractsEnvPath, 'utf8');
  const match = content.match(/^VALIDATION_REGISTRY_ADDRESS\s*=\s*(0x[a-fA-F0-9]{40})/m);
  if (!match) {
    throw new Error('VALIDATION_REGISTRY_ADDRESS not found in contracts/.env');
  }
  return match[1] as `0x${string}`;
}

function getAgentId(): bigint {
  const contractsEnvPath = path.resolve(__dirname, '../contracts/.env');
  const content = fs.readFileSync(contractsEnvPath, 'utf8');
  const match = content.match(/^ERC8004_AGENT_ID\s*=\s*(\d+)/m);
  if (!match) {
    throw new Error('ERC8004_AGENT_ID not found in contracts/.env');
  }
  return BigInt(match[1]);
}

async function main() {
  const args = process.argv.slice(2);
  const isTamperTest = args.includes('--tamper-anvil');
  const targetMission = args.find((a) => !a.startsWith('--')) || 's1b';

  const bundlePath = path.resolve(__dirname, `../evidence/validation/${targetMission}.json`);
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Bundle file not found: ${bundlePath}`);
  }

  const bundle: ValidationBundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  const requestHash = computeValidationRequestHash(bundle);
  console.log(`[Validator Run] Mission: ${targetMission}`);
  console.log(`[Validator Run] RequestHash: ${requestHash}`);

  const publicClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const registryAddress = getValidationRegistryAddress();
  const agentId = getAgentId();
  const ownerAccount = getOwnerAccount();
  const validatorAccount = getValidatorAccount();

  console.log(`[Validator Run] Registry: ${registryAddress}`);
  console.log(`[Validator Run] Agent ID: #${agentId}`);
  console.log(`[Validator Run] Owner:    ${ownerAccount.address}`);
  console.log(`[Validator Run] Validator:${validatorAccount.address}`);

  // Check if request already submitted
  const currentStatus = await publicClient.readContract({
    address: registryAddress,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: 'getValidationStatus',
    args: [requestHash],
  });

  const requestExists = currentStatus[5] > 0n; // lastUpdate > 0

  if (!requestExists) {
    console.log('[Validator Run] Submitting validationRequest from Owner...');
    const ownerWalletClient = createWalletClient({
      account: ownerAccount,
      chain: avalancheFuji,
      transport: http(FUJI_RPC_URL),
    });

    const requestURI = `evidence/validation/${targetMission}.json`;
    const requestTx = await ownerWalletClient.writeContract({
      address: registryAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: 'validationRequest',
      args: [validatorAccount.address, agentId, requestURI, requestHash],
    });

    console.log(`[Validator Run] validationRequest broadcast tx: ${requestTx}`);
    const reqReceipt = await publicClient.waitForTransactionReceipt({ hash: requestTx });
    console.log(`[Validator Run] validationRequest confirmed in block ${reqReceipt.blockNumber}`);
  } else {
    console.log('[Validator Run] validationRequest already registered on-chain.');
  }

  // 2. Perform independent validation directly on-chain
  console.log('[Validator Run] Evaluating bundle against on-chain contract state...');
  const validationResult = await validateBundleOnChain(publicClient, bundle);
  console.log(`[Validator Run] Result: valid=${validationResult.valid}, score=${validationResult.score}, tag=${validationResult.tag}`);
  console.log('[Validator Run] Detailed checks:', JSON.stringify(validationResult.checks, null, 2));

  // 3. Write response evidence JSON
  const responseData = {
    requestHash,
    missionId: bundle.missionId,
    missionSlug: bundle.missionSlug,
    evaluatedAt: new Date().toISOString(),
    validatorAddress: validatorAccount.address,
    agentId: agentId.toString(),
    score: validationResult.score,
    tag: validationResult.tag,
    checks: validationResult.checks,
    details: validationResult.details,
  };

  const responseJsonString = JSON.stringify(responseData, null, 2);
  const responseHash = keccak256(toHex(responseJsonString));
  const responsePath = path.resolve(__dirname, `../evidence/validation/${targetMission}.response.json`);
  fs.writeFileSync(responsePath, responseJsonString, 'utf8');
  console.log(`[Validator Run] Saved response evidence to ${responsePath}`);

  // 4. Submit validationResponse (contract permits update by authorized validator)
  console.log('[Validator Run] Submitting/updating validationResponse from Validator...');
  const validatorWalletClient = createWalletClient({
    account: validatorAccount,
    chain: avalancheFuji,
    transport: http(FUJI_RPC_URL),
  });

  const responseURI = `evidence/validation/${targetMission}.response.json`;
  const respTx = await validatorWalletClient.writeContract({
    address: registryAddress,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: 'validationResponse',
    args: [requestHash, validationResult.score, responseURI, responseHash, validationResult.tag],
  });

  console.log(`[Validator Run] validationResponse broadcast tx: ${respTx}`);
  const respReceipt = await publicClient.waitForTransactionReceipt({ hash: respTx });
  console.log(`[Validator Run] validationResponse confirmed in block ${respReceipt.blockNumber}, status: ${respReceipt.status}`);
}

main().catch((err) => {
  console.error('[Validator Run Error]', err.message || err);
  process.exit(1);
});
