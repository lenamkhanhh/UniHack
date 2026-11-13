/**
 * Parameterized, minimal-budget re-creation of the s1b verifiable mission flow
 * (scripts/fuji-live-run-s1b.ts + scripts/validator-run.ts), producing a mission whose
 * DB audit chain is anchored on-chain and validated 100/100 on the ERC-8004 ValidationRegistry.
 *
 * DEFAULT TARGET IS A LOCAL ANVIL FORK. Live Fuji broadcast requires BOTH `--live` and
 * env MISSION_RUN_ALLOW_BROADCAST=1.
 *
 *   anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc --port 8557
 *   npx tsx scripts/fuji-live-run-mission.ts --slug fork-dryrun-s1c [--rpc http://127.0.0.1:8557] [--skip-x402]
 *
 * Flags:
 *   --slug <slug>            default fuji-live-mission-s1c (missionId = keccak256(utf8(slug)), as s1b)
 *   --rpc <url>              fork RPC (default http://127.0.0.1:8557); ignored with --live unless given
 *   --live                   target live Fuji (also needs MISSION_RUN_ALLOW_BROADCAST=1)
 *   --resume                 allow continuing a mission that already exists on chain / in DB
 *   --skip-x402              skip the x402 tool purchase (recorded as SKIPPED, never as success)
 *   --treasury-cap <atomic>  default 100000 (0.10 USDC)
 *   --tool-cap <atomic>      default 20000  (0.02 USDC) = setMissionToolCap = fundMissionWallet amount
 *   --payout <atomic>        default 10000  (0.01 USDC), paid to the OWNER (sole Merkle payee)
 *
 * Steps (each idempotent: skipped when its effect already exists on chain / in DB):
 *   1 createMission  2 setRecipient(owner)  3 POST /api/missions (challenge, receipt-verified creationBlock)
 *   4 setMissionToolCap  5 fundMissionWallet  6 setMissionPayeeRoot  7 POST /api/missions/<slug>/activate
 *   8 x402 tool purchase (cheapest catalog tool)  9 proposeWithProof payout  10 anchorMissionProof(real DB head)
 *   11 ERC-8004 validationRequest (owner)  12 validator validationResponse (VALIDATOR_PRIVATE_KEY) + ValidationJob row
 *
 * Output: evidence/missions/<slug>/run.json (+ validation-bundle.json, validation-response.json).
 * Never prints or writes private keys.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
  encodeFunctionData,
  decodeEventLog,
  formatEther,
  formatUnits,
  getAddress,
  keccak256,
  toHex,
  Hex,
  PublicClient,
} from 'viem';
import { privateKeyToAccount, PrivateKeyAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { loadEnvFile } from './lib/mission-audit';

// ----------------------------------------------------------------------------
// Args / network resolution (before any app module is imported: several app
// modules capture AVALANCHE_FUJI_RPC_URL at import time).
// ----------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 ? argv[i + 1] : undefined;
};

const LIVE_FUJI_RPC = 'https://api.avax-test.network/ext/bc/C/rpc';
const DEFAULT_FORK_RPC = 'http://127.0.0.1:8557';
const SLUG = opt('slug') || 'fuji-live-mission-s1c';
const RESUME = flag('resume');
const SKIP_X402 = flag('skip-x402');
const TREASURY_CAP = BigInt(opt('treasury-cap') || '100000');
const TOOL_CAP = BigInt(opt('tool-cap') || '20000');
const PAYOUT = BigInt(opt('payout') || '10000');
const DURATION_SECONDS = 604800;

const WANT_LIVE = flag('live');
const LIVE = WANT_LIVE && process.env.MISSION_RUN_ALLOW_BROADCAST === '1';
if (WANT_LIVE && !LIVE) {
  console.error('REFUSED: --live also requires env MISSION_RUN_ALLOW_BROADCAST=1');
  process.exit(2);
}
const NETWORK: 'fuji' | 'anvil-fork' = LIVE ? 'fuji' : 'anvil-fork';
const RPC_URL = LIVE ? opt('rpc') || LIVE_FUJI_RPC : opt('rpc') || DEFAULT_FORK_RPC;

if (!LIVE) {
  const host = new URL(RPC_URL).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
    console.error(`REFUSED: fork mode requires a local RPC, got host ${host}`);
    process.exit(2);
  }
  if (SLUG.startsWith('fuji-live-')) {
    console.error(`REFUSED: slug ${SLUG} is reserved for the live run; use e.g. --slug fork-dryrun-s1c on the fork`);
    process.exit(2);
  }
}

process.env.AVALANCHE_FUJI_RPC_URL = RPC_URL;
process.env.FUJI_RPC_URL = RPC_URL;
process.env.NEXT_PUBLIC_RPC_URL = RPC_URL;
process.env.PAYMENT_MODE = 'LIVE_FUJI';
process.env.DEPLOYMENT_ID = 'unihack-live-deployment';
process.env.APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000';
process.env.NEXT_PUBLIC_APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN || 'http://localhost:3000';
if (!LIVE) {
  // Public facilitators settle on LIVE Fuji: never contact them from a fork run.
  process.env.FACILITATOR_URL = 'http://127.0.0.1:9/fork-guard-no-public-facilitator';
} else {
  process.env.FACILITATOR_URL = process.env.FACILITATOR_URL || 'https://facilitator.payai.network';
}
loadEnvFile(fs, path.resolve(__dirname, '../apps/web/.env')); // does not override the values above

// Fork guard: block every non-local HTTP request except read-only eth_gasPrice/eth_chainId on live Fuji.
const blockedRequests: string[] = [];
if (!LIVE) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
      if (url.includes('fork-guard-no-public-facilitator')) {
        blockedRequests.push(url);
        throw new Error('FORK_GUARD: public facilitator disabled on fork');
      }
      return realFetch(input, init);
    }
    if (url === LIVE_FUJI_RPC) {
      try {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '');
        const calls = Array.isArray(body) ? body : [body];
        if (calls.every((c: any) => ['eth_gasPrice', 'eth_chainId'].includes(c?.method))) {
          return realFetch(input, init);
        }
      } catch {}
    }
    blockedRequests.push(url);
    throw new Error(`FORK_GUARD: blocked external request to ${host || url}`);
  }) as typeof fetch;
}

// ----------------------------------------------------------------------------
// Constants / ABIs
// ----------------------------------------------------------------------------
const EXPECTED_VALIDATION_REGISTRY = '0x4c5ccda2a630cd1cb706799deadcc8483d06697e';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const INSECURE_KEYS = new Set([
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
]);

const usdcAbi = [parseAbiItem('function balanceOf(address account) external view returns (uint256)')];
const treasuryAbi = [
  parseAbiItem('function createMission(bytes32 missionId, address agent, uint256 cap, uint256 duration) external'),
  parseAbiItem('function setRecipient(address r, bool allowed) external'),
  parseAbiItem('function setMissionToolCap(bytes32 missionId, uint256 toolCap) external'),
  parseAbiItem('function fundMissionWallet(bytes32 missionId, address wallet, uint256 amount) external'),
  parseAbiItem('function setMissionPayeeRoot(bytes32 missionId, bytes32 root) external'),
  parseAbiItem('function proposeWithProof(bytes32 operationId, address to, uint256 amount, bytes32 missionId, string reason, bytes32[] proof) external returns (uint256)'),
  parseAbiItem('function anchorMissionProof(bytes32 missionId, bytes32 headHash) external'),
  parseAbiItem('function missions(bytes32 missionId) external view returns (bytes32 id, address agent, uint256 cap, uint256 expiresAt, bool exists, bool closed)'),
  parseAbiItem('function recipientAllowlist(address r) external view returns (bool)'),
  parseAbiItem('function missionFunded(bytes32 missionId) external view returns (bool)'),
  parseAbiItem('function missionToolCap(bytes32 missionId) external view returns (uint256)'),
  parseAbiItem('function missionPayeeRoot(bytes32 missionId) external view returns (bytes32)'),
  parseAbiItem('function anchoredMissionProofs(bytes32 missionId) external view returns (bytes32)'),
  parseAbiItem('function perTxCap() external view returns (uint256)'),
  parseAbiItem('function dailyCap() external view returns (uint256)'),
  parseAbiItem('function spentToday() external view returns (uint256)'),
  parseAbiItem('function paused() external view returns (bool)'),
  parseAbiItem('function owner() external view returns (address)'),
];
const executedEventAbi = parseAbiItem('event Executed(uint256 indexed id, address indexed to, uint256 amount, bytes32 missionId)');
const queuedEventAbi = parseAbiItem('event Queued(uint256 indexed id, address indexed to, uint256 amount, string reason)');
const registryAbi = [
  parseAbiItem('function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) external'),
  parseAbiItem('function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external'),
  parseAbiItem('function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)'),
  parseAbiItem('function isValidationComplete(bytes32 requestHash) external view returns (bool)'),
];

// Default inputs for each catalog tool (used for the cheapest-tool purchase).
const TOOL_INPUTS: Record<string, Record<string, any>> = {
  'tool:talkmeter': { minuteIndex: 0 },
  'tool:search': { query: 'Avalanche platform consensus throughput' },
  'tool:summary': { text: 'Avalanche Fuji is the public testnet of the Avalanche C-Chain.' },
};

// ----------------------------------------------------------------------------
// Run record
// ----------------------------------------------------------------------------
type StepStatus = 'PASSED' | 'SKIPPED_ALREADY_DONE' | 'SKIPPED' | 'FAILED';
interface TxRecord {
  step: string;
  label: string;
  from: string;
  to: string;
  hash: string;
  status: string;
  blockNumber: string;
  gasUsed: string;
  effectiveGasPrice: string;
  feeWei: string;
  paidBy: 'owner' | 'agent' | 'validator' | 'facilitator';
}
interface StepRecord { step: string; name: string; status: StepStatus; detail?: string; txHash?: string }

const outDir = path.resolve(__dirname, `../evidence/missions/${SLUG}`);
const runPath = path.join(outDir, 'run.json');
const previous: any = RESUME && fs.existsSync(runPath) ? JSON.parse(fs.readFileSync(runPath, 'utf8')) : null;

const run: any = {
  version: 'MissionPay-mission-run-v1',
  network: NETWORK,
  chainId: 43113,
  rpc: LIVE ? RPC_URL : `${RPC_URL} (anvil fork of ${LIVE_FUJI_RPC})`,
  slug: SLUG,
  startedAt: new Date().toISOString(),
  finishedAt: null as string | null,
  params: {
    treasuryCap: TREASURY_CAP.toString(),
    toolCap: TOOL_CAP.toString(),
    payout: PAYOUT.toString(),
    durationSeconds: DURATION_SECONDS,
    skipX402: SKIP_X402,
    resume: RESUME,
  },
  addresses: {} as Record<string, string>,
  preflight: {} as Record<string, any>,
  steps: [] as StepRecord[],
  txs: (previous?.txs || []) as TxRecord[],
  state: (previous?.state || {}) as Record<string, string>,
  x402: { status: 'NOT_RUN' } as Record<string, any>,
  summary: {} as Record<string, any>,
  forkGuardBlockedRequests: blockedRequests,
  error: null as string | null,
};

const j = (o: any) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
// Until preflight passes, never touch an existing run.json (a refused re-run must not clobber evidence).
let preflightPassed = false;
function save() {
  fs.mkdirSync(outDir, { recursive: true });
  const target = preflightPassed ? runPath : path.join(outDir, 'preflight-failed.json');
  fs.writeFileSync(target, j(run) + '\n', 'utf8');
}
function step(stepId: string, name: string, status: StepStatus, detail?: string, txHash?: string) {
  run.steps.push({ step: stepId, name, status, detail, txHash });
  console.log(`  [${stepId}] ${name}: ${status}${detail ? ` - ${detail}` : ''}${txHash ? ` (${txHash})` : ''}`);
  save();
}

function readKeyFromFile(file: string, name: string): Hex | undefined {
  if (!fs.existsSync(file)) return undefined;
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${name}\\s*=\\s*(0x[a-fA-F0-9]{64})`, 'm'));
  return m ? (m[1] as Hex) : undefined;
}
function loadKey(name: string): Hex {
  const key = (process.env[name] as Hex | undefined) || readKeyFromFile(path.resolve(__dirname, '../contracts/.env'), name);
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`SECURITY_ERROR: valid ${name} not found`);
  if (INSECURE_KEYS.has(key.toLowerCase())) throw new Error(`SECURITY_ERROR: insecure well-known ${name} rejected`);
  return key;
}

async function main() {
  console.log('========================================================================');
  console.log(`MISSIONPAY MISSION RUN: ${SLUG}  [network=${NETWORK}]`);
  console.log('========================================================================');

  // App modules: imported only now, after env is set for the chosen RPC.
  const ownerSign = await import('./owner-sign');
  const { computePayeeMerkleTree } = await import('../apps/web/lib/merkle');
  const { getSessionWalletForMission } = await import('../apps/web/lib/session-wallets');
  const { prisma, withLockOrder } = await import('../apps/web/lib/db');
  const payments = await import('../apps/web/lib/payments');
  const { appendAuditEntry } = await import('../apps/web/lib/audit');
  const { issueSpendToken, verifyToken } = await import('../apps/web/lib/auth');
  const { hashUtf8 } = await import('../apps/web/lib/chain');
  const { validateProposal } = await import('../apps/web/lib/validator');
  const { verifyProof } = await import('../apps/web/lib/proof-verifier');
  const { toolCatalog } = await import('../apps/web/lib/tools');
  const { setChainReader, createProductionChainReader } = await import('../apps/web/lib/reconcile');
  const { getGuardedTreasuryAddress } = await import('../apps/web/lib/config');
  const { computeValidationRequestHash, validateBundleOnChain } = await import('../apps/web/lib/validation-bundle');
  const { POST: challengePOST } = await import('../apps/web/app/api/auth/challenge/route');
  const { POST: createMissionPOST } = await import('../apps/web/app/api/missions/route');
  const { POST: activatePOST } = await import('../apps/web/app/api/missions/[slug]/activate/route');
  const { NextRequest } = await import('next/server');

  // reconcile.ts defaults to the hard-coded live RPC constant; point it at the chosen RPC.
  setChainReader(createProductionChainReader(RPC_URL));

  const TREASURY = getAddress(ownerSign.GUARDED_TREASURY_ADDRESS) as `0x${string}`;
  const USDC = getAddress(ownerSign.FUJI_USDC_ADDRESS) as `0x${string}`;
  const OWNER = getAddress(ownerSign.EXPECTED_OWNER_ADDRESS) as `0x${string}`;
  const AGENT = getAddress(ownerSign.EXPECTED_AGENT_ADDRESS) as `0x${string}`;
  const REGISTRY = getAddress(process.env.VALIDATION_REGISTRY_ADDRESS || EXPECTED_VALIDATION_REGISTRY) as `0x${string}`;
  if (REGISTRY.toLowerCase() !== EXPECTED_VALIDATION_REGISTRY) {
    throw new Error(`VALIDATION_REGISTRY_ADDRESS ${REGISTRY} != expected ${EXPECTED_VALIDATION_REGISTRY}`);
  }
  if (getAddress(getGuardedTreasuryAddress()) !== TREASURY) {
    throw new Error('GUARDED_TREASURY_ADDRESS mismatch between app config and owner-sign');
  }
  const AGENT_ID = BigInt(process.env.ERC8004_AGENT_ID || readAgentIdFromContractsEnv() || '0');
  if (AGENT_ID === 0n) throw new Error('ERC8004_AGENT_ID not configured');

  const ownerAccount = ownerSign.getOwnerAccount();
  const agentAccount = privateKeyToAccount(loadKey('AGENT_PRIVATE_KEY'));
  const validatorAccount = privateKeyToAccount(loadKey('VALIDATOR_PRIVATE_KEY'));
  if (ownerAccount.address !== OWNER) throw new Error(`Owner key address ${ownerAccount.address} != ${OWNER}`);
  if (agentAccount.address !== AGENT) throw new Error(`Agent key address ${agentAccount.address} != ${AGENT}`);
  if (process.env.VALIDATOR_ADDRESS && getAddress(process.env.VALIDATOR_ADDRESS) !== validatorAccount.address) {
    throw new Error('VALIDATOR_ADDRESS does not match VALIDATOR_PRIVATE_KEY');
  }

  const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(RPC_URL) }) as PublicClient;
  const missionId = hashUtf8(SLUG);
  const payees = [OWNER];
  const tree = computePayeeMerkleTree(payees);
  const sessionWallet = getSessionWalletForMission(SLUG);
  const sellerAddress = process.env.SELLER_ADDRESS || '0xd4ce6B645ACd77BefA0E2693D26B50482426dEcB';

  run.addresses = {
    treasury: TREASURY, usdc: USDC, owner: OWNER, agent: AGENT, validator: validatorAccount.address,
    validationRegistry: REGISTRY, sessionWallet: sessionWallet.address, seller: sellerAddress,
    missionId, payeeRoot: tree.root, agentId: AGENT_ID.toString(),
  };
  console.log(j(run.addresses));

  // --------------------------------------------------------------------------
  // tx helper: wait for receipt, require success, record gas
  // --------------------------------------------------------------------------
  const allowedTargets: Record<string, Set<string>> = {
    owner: new Set([TREASURY, REGISTRY]),
    agent: new Set([TREASURY]),
    validator: new Set([REGISTRY]),
  };
  const receipts: any[] = [];
  async function sendTx(stepId: string, label: string, role: 'owner' | 'agent' | 'validator', account: PrivateKeyAccount, to: `0x${string}`, data: Hex) {
    if (!allowedTargets[role].has(getAddress(to))) throw new Error(`SECURITY_ERROR: ${role} target ${to} not allowed`);
    const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(RPC_URL) });
    const hash = await wallet.sendTransaction({ account, to, data, chain: avalancheFuji });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    receipts.push(receipt);
    const rec: TxRecord = {
      step: stepId, label, from: account.address, to, hash, status: receipt.status,
      blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      feeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(), paidBy: role,
    };
    run.txs.push(rec);
    save();
    if (receipt.status !== 'success') throw new Error(`${label} REVERTED: ${hash}`);
    console.log(`    tx ${label}: ${hash} block ${receipt.blockNumber} gasUsed ${receipt.gasUsed}`);
    return receipt;
  }
  const read = (functionName: any, args: any[] = []) =>
    publicClient.readContract({ address: TREASURY, abi: treasuryAbi, functionName, args } as any) as Promise<any>;

  // --------------------------------------------------------------------------
  // PREFLIGHT (no tx before this passes)
  // --------------------------------------------------------------------------
  console.log('\n[PREFLIGHT]');
  const chainId = await publicClient.getChainId();
  if (chainId !== 43113) throw new Error(`RPC chainId ${chainId} != 43113`);
  let clientVersion = '';
  try { clientVersion = await publicClient.request({ method: 'web3_clientVersion' as any }) as string; } catch {}
  if (!LIVE && !/anvil/i.test(clientVersion)) throw new Error(`Fork mode requires an anvil RPC (web3_clientVersion=${clientVersion})`);
  if (LIVE && /anvil/i.test(clientVersion)) throw new Error('--live pointed at an anvil node');

  const gasPrice = await publicClient.getGasPrice();
  let liveGasPrice: bigint | null = null;
  try {
    liveGasPrice = await createPublicClient({ chain: avalancheFuji, transport: http(LIVE_FUJI_RPC) }).getGasPrice();
  } catch (e: any) {
    console.warn(`  live Fuji eth_gasPrice read failed: ${e.message}`);
  }

  const cheapest = Object.values(toolCatalog).reduce((a: any, b: any) => (b.priceAtomic < a.priceAtomic ? b : a)) as any;
  const toolPrice: bigint = cheapest.priceAtomic;

  const [ownerAvax, agentAvax, validatorAvax, treasuryUsdc, perTxCap, dailyCap, spentToday, paused, onchainOwner, onchainMission] =
    await Promise.all([
      publicClient.getBalance({ address: OWNER }),
      publicClient.getBalance({ address: AGENT }),
      publicClient.getBalance({ address: validatorAccount.address }),
      publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [TREASURY] }),
      read('perTxCap'), read('dailyCap'), read('spentToday'), read('paused'), read('owner'), read('missions', [missionId]),
    ]);

  // Conservative gas budgets per role (actuals are recorded per tx).
  const GAS_BUDGET = { owner: 900_000n, agent: 350_000n, validator: 250_000n };
  const needed = (g: bigint) => (g * gasPrice * 3n) / 2n;
  const usdcNeeded = TOOL_CAP + PAYOUT;
  const dailyRemaining = (dailyCap as bigint) - (spentToday as bigint);
  const dbMissionPre = await prisma.mission.findUnique({ where: { slug: SLUG } });

  run.preflight = {
    rpcClientVersion: clientVersion,
    gasPriceWei: gasPrice.toString(),
    liveFujiGasPriceWei: liveGasPrice?.toString() ?? null,
    owner: { avax: formatEther(ownerAvax), neededAvax: formatEther(needed(GAS_BUDGET.owner)) },
    agent: { avax: formatEther(agentAvax), neededAvax: formatEther(needed(GAS_BUDGET.agent)) },
    validator: { avax: formatEther(validatorAvax), neededAvax: formatEther(needed(GAS_BUDGET.validator)) },
    treasury: {
      usdc: formatUnits(treasuryUsdc as bigint, 6), neededUsdc: formatUnits(usdcNeeded, 6),
      perTxCap: formatUnits(perTxCap, 6), dailyCap: formatUnits(dailyCap, 6),
      spentToday: formatUnits(spentToday, 6), dailyRemaining: formatUnits(dailyRemaining, 6), paused,
    },
    cheapestTool: { id: cheapest.id, priceAtomic: toolPrice.toString() },
    missionExistsOnChain: onchainMission[4],
    missionExistsInDb: Boolean(dbMissionPre),
  };
  console.log(j(run.preflight));
  save();

  const problems: string[] = [];
  if (getAddress(onchainOwner) !== OWNER) problems.push(`treasury owner ${onchainOwner} != ${OWNER}`);
  if (paused) problems.push('treasury is paused');
  if (ownerAvax < needed(GAS_BUDGET.owner)) problems.push('owner AVAX below budget');
  if (agentAvax < needed(GAS_BUDGET.agent)) problems.push('agent AVAX below budget');
  if (validatorAvax < needed(GAS_BUDGET.validator)) problems.push('validator AVAX below budget');
  if ((treasuryUsdc as bigint) < usdcNeeded) problems.push(`treasury USDC < ${formatUnits(usdcNeeded, 6)}`);
  if (PAYOUT > perTxCap) problems.push('payout > perTxCap (would queue, not execute)');
  if (PAYOUT > dailyRemaining) problems.push('payout > remaining dailyCap (would queue, not execute)');
  if (PAYOUT > TREASURY_CAP) problems.push('payout > treasuryCap (would queue, not execute)');
  if (TOOL_CAP > TREASURY_CAP) problems.push('toolCap > treasuryCap');
  if (!SKIP_X402 && TOOL_CAP < toolPrice) {
    problems.push(`toolCap ${TOOL_CAP} < cheapest catalog price ${toolPrice} (${cheapest.id}); pass --tool-cap ${toolPrice} or --skip-x402`);
  }
  if (onchainMission[4] && !RESUME) problems.push(`mission ${SLUG} already exists on chain (use --resume)`);
  if (dbMissionPre && !RESUME) problems.push(`mission ${SLUG} already exists in DB (use --resume)`);
  if (problems.length) throw new Error(`PREFLIGHT FAILED:\n  - ${problems.join('\n  - ')}`);
  console.log('  Preflight OK');
  preflightPassed = true;
  fs.rmSync(path.join(outDir, 'preflight-failed.json'), { force: true });
  save();

  // System state for Stage S2 (same as s1b)
  await prisma.systemState.upsert({
    where: { id: 1 },
    create: { id: 1, deploymentId: 'unihack-live-deployment', stage: 'S2', authVersion: 1, guardAddress: TREASURY, systemPaused: false, maintenance: false },
    update: { deploymentId: 'unihack-live-deployment', stage: 'S2', guardAddress: TREASURY, systemPaused: false },
  });

  const auditEntriesFor = () => prisma.auditEntry.findMany({ where: { missionSlug: SLUG }, orderBy: { missionSequence: 'asc' } });
  const findEntryTx = async (kind: string) => {
    for (const e of await auditEntriesFor()) {
      try {
        const p = JSON.parse(e.missionCanonicalJson || e.canonicalJson);
        if (p.kind === kind && p.tx_hash) return p.tx_hash as string;
      } catch {}
    }
    return undefined;
  };

  console.log('\n[STEPS]');

  // 1. createMission on chain
  if (!onchainMission[4]) {
    const r = await sendTx('1', 'createMission', 'owner', ownerAccount, TREASURY,
      encodeFunctionData({ abi: treasuryAbi, functionName: 'createMission', args: [missionId, AGENT, TREASURY_CAP, BigInt(DURATION_SECONDS)] }));
    run.state.createMissionTx = r.transactionHash;
    step('1', 'createMission', 'PASSED', `cap ${TREASURY_CAP}`, r.transactionHash);
  } else {
    run.state.createMissionTx = run.state.createMissionTx || dbMissionPre?.creationTxHash || '';
    step('1', 'createMission', 'SKIPPED_ALREADY_DONE', 'missions(missionId).exists', run.state.createMissionTx || undefined);
  }

  // 2. setRecipient(owner)
  if (!(await read('recipientAllowlist', [OWNER]))) {
    const r = await sendTx('2', 'setRecipient(owner)', 'owner', ownerAccount, TREASURY,
      encodeFunctionData({ abi: treasuryAbi, functionName: 'setRecipient', args: [OWNER, true] }));
    step('2', 'setRecipient(owner)', 'PASSED', undefined, r.transactionHash);
  } else {
    step('2', 'setRecipient(owner)', 'SKIPPED_ALREADY_DONE', 'owner already allowlisted');
  }

  // 3. App: challenge + POST /api/missions
  if (!dbMissionPre) {
    const createPayload: Record<string, any> = {
      slug: SLUG, agentAddress: AGENT, treasuryCap: TREASURY_CAP.toString(), toolCap: TOOL_CAP.toString(),
      durationSeconds: DURATION_SECONDS, payees, targetMissionSlug: SLUG,
    };
    if (run.state.createMissionTx) createPayload.receiptTxHash = run.state.createMissionTx;
    const chRes = await challengePOST(new NextRequest(`${process.env.APP_ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CREATE_MISSION', payload: createPayload, expectedSigner: OWNER }),
    }));
    const ch = await chRes.json();
    if (chRes.status !== 200 || !ch.nonce) throw new Error(`CREATE_MISSION challenge failed: ${JSON.stringify(ch)}`);
    const signature = await ownerAccount.signMessage({ message: ch.message });
    const res = await createMissionPOST(new NextRequest(`${process.env.APP_ORIGIN}/api/missions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: ch.nonce, signature, payload: createPayload }),
    }));
    const data = await res.json();
    if (res.status !== 201 && res.status !== 200) throw new Error(`POST /api/missions failed ${res.status}: ${JSON.stringify(data)}`);
    const m = await prisma.mission.findUnique({ where: { slug: SLUG } });
    step('3', 'POST /api/missions (EIP-191 challenge)', 'PASSED', `creationBlock ${m?.creationBlock ?? 'null'} (${m?.creationProvenance ?? 'unverified'})`);
  } else {
    step('3', 'POST /api/missions (EIP-191 challenge)', 'SKIPPED_ALREADY_DONE', 'mission row exists in DB');
  }

  // 4. setMissionToolCap
  const funded = await read('missionFunded', [missionId]);
  const currentToolCap: bigint = await read('missionToolCap', [missionId]);
  if (!funded && currentToolCap !== TOOL_CAP) {
    const r = await sendTx('4', 'setMissionToolCap', 'owner', ownerAccount, TREASURY,
      encodeFunctionData({ abi: treasuryAbi, functionName: 'setMissionToolCap', args: [missionId, TOOL_CAP] }));
    step('4', 'setMissionToolCap', 'PASSED', `toolCap ${TOOL_CAP}`, r.transactionHash);
  } else {
    step('4', 'setMissionToolCap', 'SKIPPED_ALREADY_DONE', `on-chain toolCap ${currentToolCap}`);
  }

  // 5. fundMissionWallet
  if (!funded) {
    const r = await sendTx('5', 'fundMissionWallet', 'owner', ownerAccount, TREASURY,
      encodeFunctionData({ abi: treasuryAbi, functionName: 'fundMissionWallet', args: [missionId, sessionWallet.address as `0x${string}`, TOOL_CAP] }));
    run.state.fundingTx = r.transactionHash;
    step('5', 'fundMissionWallet', 'PASSED', `${TOOL_CAP} -> session wallet ${sessionWallet.address}`, r.transactionHash);
  } else {
    run.state.fundingTx = run.state.fundingTx || (await findEntryTx('SESSION_WALLET_FUNDED')) || '';
    step('5', 'fundMissionWallet', 'SKIPPED_ALREADY_DONE', 'missionFunded = true', run.state.fundingTx || undefined);
  }

  // 6. setMissionPayeeRoot
  const onchainRoot: string = await read('missionPayeeRoot', [missionId]);
  if (onchainRoot.toLowerCase() !== tree.root.toLowerCase()) {
    const r = await sendTx('6', 'setMissionPayeeRoot', 'owner', ownerAccount, TREASURY,
      encodeFunctionData({ abi: treasuryAbi, functionName: 'setMissionPayeeRoot', args: [missionId, tree.root] }));
    run.state.payeeRootTx = r.transactionHash;
    step('6', 'setMissionPayeeRoot', 'PASSED', `root ${tree.root} (payees = [owner])`, r.transactionHash);
  } else {
    run.state.payeeRootTx = run.state.payeeRootTx || (await findEntryTx('PAYEE_ROOT_SET')) || '';
    step('6', 'setMissionPayeeRoot', 'SKIPPED_ALREADY_DONE', 'root already set', run.state.payeeRootTx || undefined);
  }

  // 7. Activate via app (receipts verified by the app against the same RPC)
  let spendToken: string;
  const alreadyActivated = Boolean(await findEntryTx('SESSION_WALLET_FUNDED')) && Boolean(await findEntryTx('PAYEE_ROOT_SET'));
  if (!alreadyActivated) {
    if (!run.state.fundingTx || !run.state.payeeRootTx) throw new Error('Missing fundingTx/payeeRootTx for activation (resume without run.json?)');
    const m = await prisma.mission.findUniqueOrThrow({ where: { slug: SLUG } });
    const actPayload = {
      missionId, ownerAddress: OWNER, agentAddress: AGENT, treasuryCap: TREASURY_CAP.toString(), toolCap: TOOL_CAP.toString(),
      configVersion: m.configVersion, policyHash: m.policyHash, targetMissionSlug: SLUG, payees,
      fundingTxHash: run.state.fundingTx, payeeRootTxHash: run.state.payeeRootTx,
    };
    const chRes = await challengePOST(new NextRequest(`${process.env.APP_ORIGIN}/api/auth/challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ACTIVATE', payload: actPayload, expectedSigner: OWNER }),
    }));
    const ch = await chRes.json();
    if (chRes.status !== 200 || !ch.nonce) throw new Error(`ACTIVATE challenge failed: ${JSON.stringify(ch)}`);
    const signature = await ownerAccount.signMessage({ message: ch.message });
    const res = await activatePOST(new NextRequest(`${process.env.APP_ORIGIN}/api/missions/${SLUG}/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: ch.nonce, signature, payload: actPayload, fundingTxHash: run.state.fundingTx, payeeRootTxHash: run.state.payeeRootTx }),
    }), { params: Promise.resolve({ slug: SLUG }) });
    const data = await res.json();
    if (res.status !== 200 || !data.spendToken) throw new Error(`Activation failed ${res.status}: ${JSON.stringify(data)}`);
    spendToken = data.spendToken;
    step('7', 'POST /api/missions/<slug>/activate (app verifies funding + payee-root receipts)', 'PASSED',
      `session wallet ${data.sessionWallet?.status}, payee root ${data.payeeInfo?.status}`);
  } else {
    const m = await prisma.mission.findUniqueOrThrow({ where: { slug: SLUG } });
    const st = await prisma.systemState.findUniqueOrThrow({ where: { id: 1 } });
    spendToken = await issueSpendToken({
      deploymentId: st.deploymentId, stage: st.stage as 'S2', guardAddress: st.guardAddress, authVersion: st.authVersion,
      missionSlug: m.slug, missionId: m.missionId, ownerAddress: m.ownerAddress, agentAddress: m.agentAddress,
      missionConfigVersion: m.configVersion, policyHash: m.policyHash, missionExpiresAt: m.expiresAt,
      appOrigin: process.env.APP_ORIGIN,
    });
    step('7', 'activate', 'SKIPPED_ALREADY_DONE', 'SESSION_WALLET_FUNDED + PAYEE_ROOT_SET entries exist; spend token re-issued');
  }
  const tokenClaims = await verifyToken(spendToken, { expectedStage: 'S2' });

  // 8. x402 tool purchase via app pipeline
  const settledExisting = await prisma.toolOperation.findFirst({ where: { missionSlug: SLUG, state: 'SETTLED', txHash: { not: null } } });
  if (SKIP_X402) {
    run.x402 = { status: 'SKIPPED', reason: '--skip-x402', cheapestTool: cheapest.id, priceAtomic: toolPrice.toString() };
    step('8', 'x402 tool purchase', 'SKIPPED', '--skip-x402 (not a success)');
  } else if (settledExisting) {
    run.x402 = { status: 'SETTLED', operationId: settledExisting.operationId, txHash: settledExisting.txHash, reused: true };
    step('8', 'x402 tool purchase', 'SKIPPED_ALREADY_DONE', `operation ${settledExisting.operationId}`, settledExisting.txHash!);
  } else {
    const operationId = randomUUID();
    const input = TOOL_INPUTS[cheapest.id] || {};
    try {
      await payments.createQuote({ operationId, toolId: cheapest.id, input, tokenClaims, sellerAddress, appOrigin: process.env.APP_ORIGIN! });
      await payments.reserveOperation({ operationId, tokenClaims });
      await payments.signOperationAuthorization({ operationId, tokenClaims });
      const exec = await payments.executeUpstreamAndSettle({ operationId, claims: tokenClaims, toolId: cheapest.id, arguments: input });
      const op: any = exec.operation;
      if (op?.state !== 'SETTLED' || !op?.txHash) {
        run.x402 = { status: 'FAILED', operationId, state: op?.state, failureReason: op?.failureReason, blockedRequests: [...blockedRequests] };
        step('8', 'x402 tool purchase', 'FAILED', `state ${op?.state} ${op?.failureReason || ''}`);
        throw new Error(`x402 purchase not settled (state ${op?.state}); re-run with --resume --skip-x402 to continue without it`);
      }
      const rc = await publicClient.getTransactionReceipt({ hash: op.txHash });
      const tx = await publicClient.getTransaction({ hash: op.txHash });
      receipts.push(rc);
      run.txs.push({
        step: '8', label: `x402 settle ${cheapest.id} (transferWithAuthorization)`, from: tx.from, to: rc.to || USDC, hash: op.txHash,
        status: rc.status, blockNumber: rc.blockNumber.toString(), gasUsed: rc.gasUsed.toString(),
        effectiveGasPrice: rc.effectiveGasPrice.toString(), feeWei: (rc.gasUsed * rc.effectiveGasPrice).toString(), paidBy: 'facilitator',
      });
      const facilitator = LIVE ? 'public facilitator (PayAI) or self-hosted fallback' : 'self-hosted fallback (public facilitators blocked on fork)';
      run.x402 = { status: 'SETTLED', operationId, toolId: cheapest.id, priceAtomic: toolPrice.toString(), txHash: op.txHash, relayer: tx.from, facilitator, blockedRequests: [...blockedRequests] };
      step('8', `x402 tool purchase (${cheapest.id})`, 'PASSED', `relayer ${tx.from}; ${facilitator}`, op.txHash);
    } catch (err: any) {
      if (run.x402.status !== 'FAILED') {
        run.x402 = { status: 'FAILED', operationId, error: err.message, blockedRequests: [...blockedRequests] };
        step('8', 'x402 tool purchase', 'FAILED', err.message);
      }
      throw err;
    }
  }

  // 9. proposeWithProof payout -> owner
  const missionNow = await prisma.mission.findUniqueOrThrow({ where: { slug: SLUG } });
  const existingPayout = await prisma.auditEntry.findFirst({ where: { missionSlug: SLUG, sourceKey: { startsWith: `treasury:${SLUG}:payout:` } } });
  if (!existingPayout) {
    const proposal = {
      kind: 'treasury_payout' as const, mission_id: SLUG, to: OWNER, amount_atomic: PAYOUT.toString(),
      reason: 'Milestone payout to owner-signed payee (provenance: OWNER_MISSION)',
    };
    const verdict = validateProposal(proposal, {
      tokenClaims, systemPaused: false, maintenance: false, stage: 'S2',
      mission: {
        slug: SLUG, missionId, status: 'ACTIVE', expiresAt: missionNow.expiresAt, ownerAddress: OWNER, agentAddress: AGENT,
        toolCap: BigInt(missionNow.toolCap.toString()), spentTool: BigInt(missionNow.spentTool.toString()),
        reservedTool: BigInt(missionNow.reservedTool.toString()), treasuryCap: TREASURY_CAP, configVersion: missionNow.configVersion,
      },
      ownerSignedPayees: payees,
      treasuryAllowlist: [OWNER],
    } as any);
    if (verdict.outcome !== 'PASS') throw new Error(`Validator rejected payout: ${verdict.reason} (${verdict.rule})`);
    const payoutOperationId = randomUUID();
    const proof = tree.getProof(OWNER) || [];
    const r = await sendTx('9', 'proposeWithProof', 'agent', agentAccount, TREASURY,
      encodeFunctionData({ abi: treasuryAbi, functionName: 'proposeWithProof', args: [hashUtf8(payoutOperationId), OWNER, PAYOUT, missionId, proposal.reason, proof] }));
    const executed = r.logs.some((l: any) => {
      if (getAddress(l.address) !== TREASURY) return false;
      try { return decodeEventLog({ abi: [executedEventAbi], data: l.data, topics: l.topics }).eventName === 'Executed'; } catch { return false; }
    });
    const queued = r.logs.some((l: any) => {
      try { return decodeEventLog({ abi: [queuedEventAbi], data: l.data, topics: l.topics }).eventName === 'Queued'; } catch { return false; }
    });
    if (!executed) throw new Error(`proposeWithProof did not execute (queued=${queued}): ${r.transactionHash}`);
    run.state.payoutTx = r.transactionHash;
    await withLockOrder(async (tx) => {
      await appendAuditEntry(tx, {
        actor: AGENT, amount: PAYOUT.toString(), chain_id: '43113', kind: 'PROPOSED', mission_id: SLUG,
        operation_id: payoutOperationId, policy_hash: missionNow.policyHash, policy_version: String(missionNow.configVersion),
        reason: proposal.reason, result_hash: ZERO32, rule: 'TREASURY_PROPOSED',
        source_key: `treasury:${SLUG}:payout:${payoutOperationId}`, to: OWNER, tx_hash: r.transactionHash,
      });
    }, { missionSlug: SLUG, lockAuditHead: true });
    step('9', 'proposeWithProof payout -> owner', 'PASSED', `${PAYOUT} executed (Executed event)`, r.transactionHash);
  } else {
    run.state.payoutTx = run.state.payoutTx || JSON.parse(existingPayout.canonicalJson).tx_hash;
    step('9', 'proposeWithProof payout', 'SKIPPED_ALREADY_DONE', 'payout audit entry exists', run.state.payoutTx);
  }

  // 10. anchor REAL DB audit head
  const dbM = await prisma.mission.findUniqueOrThrow({ where: { slug: SLUG } });
  const realHead = dbM.auditHeadHash as Hex;
  if (!realHead || realHead === ZERO32) throw new Error('Mission has no audit head in DB');
  const anchored: string = await read('anchoredMissionProofs', [missionId]);
  if (anchored.toLowerCase() !== realHead.toLowerCase()) {
    const r = await sendTx('10', 'anchorMissionProof', 'owner', ownerAccount, TREASURY,
      encodeFunctionData({ abi: treasuryAbi, functionName: 'anchorMissionProof', args: [missionId, realHead] }));
    run.state.anchorTx = r.transactionHash;
    step('10', 'anchorMissionProof(real DB head)', 'PASSED', `head ${realHead}`, r.transactionHash);
  } else {
    run.state.anchorTx = run.state.anchorTx || dbM.deliverableHash || '';
    step('10', 'anchorMissionProof', 'SKIPPED_ALREADY_DONE', 'on-chain head == DB head', run.state.anchorTx || undefined);
  }
  if (!run.state.anchorTx) throw new Error('anchor tx hash unknown');
  const anchoredAfter: string = await read('anchoredMissionProofs', [missionId]);
  if (anchoredAfter.toLowerCase() !== realHead.toLowerCase()) throw new Error('anchoredMissionProofs != DB head after anchor');

  // Publish for /verify; deliverableHash carries the anchor tx (used by /verify and the bundle builder).
  await prisma.mission.update({
    where: { slug: SLUG },
    data: { publicPublished: true, status: 'CLOSED', completedAt: dbM.completedAt ?? new Date(), deliverableHash: run.state.anchorTx },
  });
  const entries = await auditEntriesFor();
  const proofRes = verifyProof(
    entries.map((e) => ({ sourceKey: e.sourceKey, prevHash: e.missionPrevHash || e.prevHash, entryHash: e.missionEntryHash || e.entryHash, canonicalJson: e.missionCanonicalJson || e.canonicalJson })),
    { headHash: anchoredAfter, entryCount: entries.length }
  );
  if (!proofRes.valid) throw new Error(`verifyProof failed: ${proofRes.errors.join('; ')}`);
  console.log(`    verifyProof: VALID (${proofRes.totalEntries} entries, head == on-chain anchor)`);

  // 11/12. ERC-8004 validation (bundle identical to the one /verify/<slug> recomputes)
  const finalMission = await prisma.mission.findUniqueOrThrow({ where: { slug: SLUG } });
  const bundle: any = {
    version: 'MissionPay-validation-v1',
    missionId: missionId.padEnd(66, '0'),
    missionSlug: SLUG,
    payeeRoot: finalMission.payeeRoot,
    auditHead: anchoredAfter,
    anchorTxHash: run.state.anchorTx,
    chainId: 43113,
    treasury: TREASURY,
    payees: JSON.parse(finalMission.payeesJson || '[]'),
    cap: finalMission.treasuryCap.toString(),
    ownerAddress: finalMission.ownerAddress,
    creationBlock: finalMission.creationBlock ?? undefined,
  };
  if (bundle.creationBlock === undefined) throw new Error('mission.creationBlock missing (creation receipt not verified)');
  const requestHash = computeValidationRequestHash(bundle);
  const bundleRel = `evidence/missions/${SLUG}/validation-bundle.json`;
  fs.writeFileSync(path.resolve(__dirname, '..', bundleRel), j(bundle) + '\n', 'utf8');
  run.state.requestHash = requestHash;

  const status0 = (await publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'getValidationStatus', args: [requestHash] })) as any;
  if (status0[5] === 0n) {
    const r = await sendTx('11', 'validationRequest', 'owner', ownerAccount, REGISTRY,
      encodeFunctionData({ abi: registryAbi, functionName: 'validationRequest', args: [validatorAccount.address, AGENT_ID, bundleRel, requestHash] }));
    run.state.requestTx = r.transactionHash;
    step('11', 'ERC-8004 validationRequest (owner)', 'PASSED', `requestHash ${requestHash}`, r.transactionHash);
  } else {
    step('11', 'ERC-8004 validationRequest', 'SKIPPED_ALREADY_DONE', `requestHash ${requestHash}`, run.state.requestTx);
  }

  const evalRes = await validateBundleOnChain(publicClient, { ...bundle, creationBlock: BigInt(bundle.creationBlock) });
  if (!evalRes.valid || evalRes.score !== 100) throw new Error(`Validator evaluation failed: ${evalRes.tag} ${j(evalRes.details.failedChecks)}`);
  const responseDoc = {
    requestHash, missionId: bundle.missionId, missionSlug: SLUG, evaluatedAt: new Date().toISOString(),
    validatorAddress: validatorAccount.address, agentId: AGENT_ID.toString(), score: evalRes.score, tag: evalRes.tag,
    checks: evalRes.checks, details: evalRes.details,
  };
  const responseJson = JSON.stringify(responseDoc, null, 2);
  const responseHash = keccak256(toHex(responseJson));
  const responseRel = `evidence/missions/${SLUG}/validation-response.json`;

  const status1 = (await publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'getValidationStatus', args: [requestHash] })) as any;
  const complete1 = await publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'isValidationComplete', args: [requestHash] });
  if (!(complete1 && Number(status1[2]) === 100)) {
    fs.writeFileSync(path.resolve(__dirname, '..', responseRel), responseJson, 'utf8');
    const r = await sendTx('12', 'validationResponse', 'validator', validatorAccount, REGISTRY,
      encodeFunctionData({ abi: registryAbi, functionName: 'validationResponse', args: [requestHash, 100, responseRel, responseHash, evalRes.tag] }));
    run.state.responseTx = r.transactionHash;
    step('12', 'ERC-8004 validationResponse (validator)', 'PASSED', `score 100 tag ${evalRes.tag}`, r.transactionHash);
  } else {
    step('12', 'ERC-8004 validationResponse', 'SKIPPED_ALREADY_DONE', 'already complete with 100', run.state.responseTx);
  }
  const statusF = (await publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'getValidationStatus', args: [requestHash] })) as any;
  const completeF = await publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'isValidationComplete', args: [requestHash] });
  if (!completeF || Number(statusF[2]) !== 100) throw new Error('On-chain validation not complete with score 100');

  // Persist ValidationJob so /verify/<slug> shows the confirmed 100/100 (it reads the DB job in LIVE mode).
  const jobData = {
    missionId: finalMission.missionId, requestHash, status: 'RESPONSE_CONFIRMED', mode: 'LIVE_FUJI',
    fromBlock: finalMission.creationBlock, snapshotBlock: BigInt(evalRes.snapshotBlock || '0'), toBlock: BigInt(evalRes.toBlock || '0'),
    frozenContext: j(bundle), evaluationResult: j(evalRes), score: evalRes.score, tag: evalRes.tag,
    chainScore: Number(statusF[2]), chainTag: statusF[4], responseHash: statusF[3], validatorAddress: statusF[0],
    agentId: statusF[1].toString(), requestTxHash: run.state.requestTx || null, responseTxHash: run.state.responseTx || null,
    failureReason: null,
  };
  await prisma.validationJob.upsert({ where: { missionSlug: SLUG }, create: { missionSlug: SLUG, ...jobData }, update: jobData });
  console.log(`    ValidationJob RESPONSE_CONFIRMED (chain score ${statusF[2]}, tag ${statusF[4]})`);

  // --------------------------------------------------------------------------
  // Summary: gas + USDC moved (from Transfer logs of every receipt in this run)
  // --------------------------------------------------------------------------
  const allReceipts = [...receipts];
  for (const t of run.txs) {
    if (!allReceipts.some((r) => r.transactionHash === t.hash)) {
      const rc = await publicClient.getTransactionReceipt({ hash: t.hash as Hex }).catch(() => null);
      if (rc) allReceipts.push(rc);
    }
  }
  const usdcDelta: Record<string, bigint> = {};
  for (const rc of allReceipts) {
    for (const l of rc.logs) {
      if (getAddress(l.address) !== USDC || l.topics[0] !== TRANSFER_TOPIC) continue;
      const from = getAddress(`0x${l.topics[1]!.slice(26)}`);
      const to = getAddress(`0x${l.topics[2]!.slice(26)}`);
      const v = BigInt(l.data);
      usdcDelta[from] = (usdcDelta[from] || 0n) - v;
      usdcDelta[to] = (usdcDelta[to] || 0n) + v;
    }
  }
  const nameOf = (a: string) =>
    Object.entries(run.addresses).find(([, v]) => typeof v === 'string' && v.toLowerCase() === a.toLowerCase())?.[0] || a;
  const ourTxs = run.txs.filter((t: TxRecord) => t.paidBy !== 'facilitator');
  const gasTotal = ourTxs.reduce((s: bigint, t: TxRecord) => s + BigInt(t.gasUsed), 0n);
  const feeTotal = ourTxs.reduce((s: bigint, t: TxRecord) => s + BigInt(t.feeWei), 0n);
  const byRole: Record<string, string> = {};
  for (const role of ['owner', 'agent', 'validator', 'facilitator']) {
    const g = run.txs.filter((t: TxRecord) => t.paidBy === role).reduce((s: bigint, t: TxRecord) => s + BigInt(t.gasUsed), 0n);
    byRole[role] = g.toString();
  }
  run.summary = {
    stepsPassed: run.steps.filter((s: StepRecord) => s.status === 'PASSED').map((s: StepRecord) => s.step),
    x402: run.x402.status,
    gasUsedTotal: gasTotal.toString(),
    gasUsedByPayer: byRole,
    feeAvaxThisNetwork: formatEther(feeTotal),
    liveFujiGasPriceWei: liveGasPrice?.toString() ?? null,
    estAvaxAtLiveFujiGasPrice: liveGasPrice ? formatEther(gasTotal * liveGasPrice) : null,
    usdcMovedPerAddress: Object.fromEntries(Object.entries(usdcDelta).map(([a, v]) => [`${nameOf(a)} (${a})`, formatUnits(v, 6)])),
    auditEntries: proofRes.totalEntries,
    auditHead: anchoredAfter,
    requestHash,
    validation: { score: Number(statusF[2]), tag: statusF[4], complete: completeF },
    verifyUrl: `/verify/${SLUG}`,
  };
  run.finishedAt = new Date().toISOString();
  save();

  console.log('\n========================================================================');
  console.log(`DONE [${NETWORK}] ${SLUG}`);
  console.log(j(run.summary));
  console.log(`run.json: ${runPath}`);
  await prisma.$disconnect();
}

function readAgentIdFromContractsEnv(): string | undefined {
  const p = path.resolve(__dirname, '../contracts/.env');
  if (!fs.existsSync(p)) return undefined;
  return fs.readFileSync(p, 'utf8').match(/^ERC8004_AGENT_ID\s*=\s*(\d+)/m)?.[1];
}

main().catch(async (err) => {
  run.error = err?.message || String(err);
  run.finishedAt = new Date().toISOString();
  try { save(); } catch {}
  console.error('\nFATAL:', run.error);
  try {
    const { prisma } = await import('../apps/web/lib/db');
    await prisma.$disconnect();
  } catch {}
  process.exit(1);
});
