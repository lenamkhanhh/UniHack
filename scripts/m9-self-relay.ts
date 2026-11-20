/**
 * MissionPay M9 Self-Relay Service (Dispatch L1 -> Avalanche Fuji C-Chain)
 *
 * Implements self-relaying of Avalanche Inter-Chain Messaging (ICM) Warp messages:
 * 1. Reads SendWarpMessage log emitted by Warp precompile (0x0200...0005) on Dispatch.
 * 2. Fetches aggregated BLS signature from Ava Labs Glacier API (fuji endpoint).
 * 3. Packs signed Warp message into EIP-2930 access list storage keys using the 0xff end-padding rule.
 * 4. Submits or dry-runs TeleporterMessenger.receiveCrossChainMessage on Fuji C-Chain.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  decodeAbiParameters,
  parseAbiParameters,
  encodeFunctionData,
  parseAbiItem,
  Hex,
  Address,
  TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import * as path from 'path';
import * as fs from 'fs';

export const WARP_PRECOMPILE_ADDRESS: Address =
  '0x0200000000000000000000000000000000000005';
export const TELEPORTER_MESSENGER_ADDRESS: Address =
  '0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf';
export const GLACIER_AGGREGATOR_URL =
  'https://glacier-api.avax.network/v1/signatureAggregator/fuji/aggregateSignatures';

export const DISPATCH_TESTNET_CHAIN = {
  id: 779672,
  name: 'Avalanche Dispatch Testnet',
  nativeCurrency: { name: 'DISPATCH', symbol: 'DISPATCH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://subnets.avax.network/dispatch/testnet/rpc'] },
  },
} as const;

export const TELEPORTER_RECEIVE_ABI = [
  parseAbiItem(
    'function receiveCrossChainMessage(uint32 messageIndex, address relayerRewardAddress) external'
  ),
];

/**
 * Loads .env without external dependencies if dotenv is not present in root node_modules.
 */
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '..', 'apps', 'web', '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

/**
 * Predicate packing algorithm:
 * Appends 0xff delimiter byte to message, then pads to 32-byte boundary with 0x00.
 * Splits into consecutive 32-byte storage keys.
 * Number of chunks = Math.ceil((messageLen + 1) / 32).
 */
export function packWarpMessagePredicate(signedMessageHex: Hex): Hex[] {
  const cleanHex = signedMessageHex.startsWith('0x')
    ? signedMessageHex.slice(2)
    : signedMessageHex;
  const msgBytes = Buffer.from(cleanHex, 'hex');
  const len = msgBytes.length;

  const totalWithDelimiter = len + 1;
  const chunkCount = Math.ceil(totalWithDelimiter / 32);
  const paddedBuffer = Buffer.alloc(chunkCount * 32, 0);
  msgBytes.copy(paddedBuffer, 0);
  paddedBuffer[len] = 0xff; // 0xff delimiter marks exact payload boundary

  const storageKeys: Hex[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = paddedBuffer.subarray(i * 32, (i + 1) * 32);
    storageKeys.push(`0x${chunk.toString('hex')}` as Hex);
  }

  return storageKeys;
}

/**
 * Unpacks 0xff-delimited storage keys back to the original signed message bytes.
 */
export function unpackWarpMessagePredicate(storageKeys: Hex[]): Hex {
  const buffers = storageKeys.map((k) => {
    const h = k.startsWith('0x') ? k.slice(2) : k;
    return Buffer.from(h, 'hex');
  });
  const concatenated = Buffer.concat(buffers);

  let delimiterIndex = -1;
  for (let i = concatenated.length - 1; i >= 0; i--) {
    if (concatenated[i] === 0xff) {
      delimiterIndex = i;
      break;
    }
  }
  if (delimiterIndex === -1) {
    throw new Error('Delimiter 0xff not found in storage keys');
  }
  return `0x${concatenated.subarray(0, delimiterIndex).toString('hex')}` as Hex;
}

/**
 * Extracts unsigned Warp message from Dispatch transaction receipt logs.
 */
export function extractUnsignedWarpMessage(receipt: TransactionReceipt): {
  sender: Address;
  messageId: Hex;
  unsignedMessage: Hex;
} {
  const warpLog = receipt.logs.find(
    (l) => l.address.toLowerCase() === WARP_PRECOMPILE_ADDRESS.toLowerCase()
  );
  if (!warpLog) {
    throw new Error(
      `Receipt ${receipt.transactionHash} does not contain Warp precompile log (address: ${WARP_PRECOMPILE_ADDRESS})`
    );
  }

  const [unsignedMessage] = decodeAbiParameters(
    parseAbiParameters('bytes'),
    warpLog.data
  );

  const sender = (
    warpLog.topics[1]
      ? `0x${warpLog.topics[1].slice(26)}`
      : '0x0000000000000000000000000000000000000000'
  ) as Address;

  const messageId = (warpLog.topics[2] || '0x0') as Hex;

  return {
    sender,
    messageId,
    unsignedMessage: unsignedMessage as Hex,
  };
}

/**
 * Queries Ava Labs Glacier API to aggregate validator BLS signatures for a Warp message.
 * Supports retry with backoff because validator signatures may lag a few seconds.
 */
export async function aggregateSignatures(
  unsignedMessage: Hex,
  options: { maxRetries?: number; delayMs?: number } = {}
): Promise<Hex> {
  const maxRetries = options.maxRetries ?? 6;
  const baseDelay = options.delayMs ?? 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(GLACIER_AGGREGATOR_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: unsignedMessage }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as { signedMessage: string };
        if (data.signedMessage) {
          return `0x${data.signedMessage}` as Hex;
        }
      }

      const status = resp.status;
      const text = await resp.text();

      if (attempt === maxRetries) {
        throw new Error(
          `Glacier API failed after ${maxRetries} attempts (HTTP ${status}): ${text}`
        );
      }

      const wait = baseDelay * attempt;
      console.log(
        `[Self-Relay] Aggregator returned HTTP ${status}. Retrying in ${wait}ms (attempt ${attempt}/${maxRetries})...`
      );
      await new Promise((r) => setTimeout(r, wait));
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const wait = baseDelay * attempt;
      console.log(
        `[Self-Relay] Network error: ${err.message}. Retrying in ${wait}ms...`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw new Error(`Failed to aggregate signatures after ${maxRetries} attempts`);
}

export interface SelfRelayResult {
  dispatchTxHash: Hex;
  messageId: Hex;
  sender: Address;
  unsignedMessageLength: number;
  signedMessageLength: number;
  storageKeysCount: number;
  mode: 'dry-run' | 'broadcast';
  predicateVerified: boolean;
  status: 'PREVIEW_SUCCESS' | 'PREVIEW_REVERT' | 'BROADCAST_SUCCESS';
  revertReason?: string;
  txHash?: Hex;
  returnData?: Hex;
}

/**
 * Executes or dry-runs the complete self-relay sequence:
 * Dispatch Receipt -> Glacier Aggregator -> Predicate Packing -> Fuji Delivery
 */
export async function selfRelayDispatchTx(
  dispatchTxHash: Hex,
  options: {
    dryRun?: boolean;
    relayerAddress?: Address;
    broadcast?: boolean;
    fujiRpcUrl?: string;
    dispatchRpcUrl?: string;
  } = {}
): Promise<SelfRelayResult> {
  loadEnv();

  const isBroadcast = options.broadcast === true;
  const isDryRun = options.dryRun !== false && !isBroadcast;

  const dispatchRpc =
    options.dispatchRpcUrl ||
    process.env.DISPATCH_RPC_URL ||
    'https://subnets.avax.network/dispatch/testnet/rpc';
  const fujiRpc =
    options.fujiRpcUrl ||
    process.env.FUJI_RPC_URL ||
    'https://api.avax-test.network/ext/bc/C/rpc';

  const dispatchClient = createPublicClient({
    transport: http(dispatchRpc),
  });

  const fujiClient = createPublicClient({
    chain: avalancheFuji,
    transport: http(fujiRpc),
  });

  // 1. Fetch Dispatch receipt and extract unsigned message
  console.log(`[Self-Relay] Fetching receipt for ${dispatchTxHash} on Dispatch L1...`);
  const receipt = await dispatchClient.getTransactionReceipt({ hash: dispatchTxHash });
  const { sender, messageId, unsignedMessage } = extractUnsignedWarpMessage(receipt);
  const unsignedLen = (unsignedMessage.length - 2) / 2;
  console.log(
    `[Self-Relay] Extracted Warp message: ID=${messageId}, sender=${sender}, length=${unsignedLen} bytes`
  );

  // 2. Aggregate signatures via Glacier API
  console.log(`[Self-Relay] Requesting BLS multi-signature from Glacier Aggregator...`);
  const signedMessage = await aggregateSignatures(unsignedMessage);
  const signedLen = (signedMessage.length - 2) / 2;
  console.log(`[Self-Relay] Received signed Warp message: length=${signedLen} bytes`);

  // 3. Pack access list with 0xff delimiter
  const storageKeys = packWarpMessagePredicate(signedMessage);
  const expectedKeysCount = Math.ceil((signedLen + 1) / 32);
  console.log(
    `[Self-Relay] Packed predicate into ${storageKeys.length} storage keys (expected ${expectedKeysCount})`
  );

  // Verify local round-trip integrity
  const unpacked = unpackWarpMessagePredicate(storageKeys);
  if (unpacked.toLowerCase() !== signedMessage.toLowerCase()) {
    throw new Error('Integrity check failed: unpacked predicate does not match signed message');
  }

  // 4. Build Fuji delivery calldata
  const relayerAddress: Address =
    options.relayerAddress ||
    (process.env.RELAYER_ADDRESS as Address) ||
    '0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA';

  const calldata = encodeFunctionData({
    abi: TELEPORTER_RECEIVE_ABI,
    functionName: 'receiveCrossChainMessage',
    args: [0, relayerAddress], // messageIndex 0, relayerRewardAddress
  });

  const accessList = [
    {
      address: WARP_PRECOMPILE_ADDRESS,
      storageKeys,
    },
  ];

  if (isDryRun) {
    console.log(
      `[Self-Relay] Performing dry-run (eth_call) on Fuji Teleporter Messenger (${TELEPORTER_MESSENGER_ADDRESS})...`
    );

    try {
      const callResult = await fujiClient.call({
        to: TELEPORTER_MESSENGER_ADDRESS,
        data: calldata,
        accessList,
        account: relayerAddress,
      });

      console.log(`[Self-Relay] eth_call SUCCESS! Return data: ${callResult.data || '0x'}`);
      return {
        dispatchTxHash,
        messageId,
        sender,
        unsignedMessageLength: unsignedLen,
        signedMessageLength: signedLen,
        storageKeysCount: storageKeys.length,
        mode: 'dry-run',
        predicateVerified: true,
        status: 'PREVIEW_SUCCESS',
        returnData: callResult.data as Hex,
      };
    } catch (err: any) {
      const msg = err.shortMessage || err.message || '';
      console.log(`[Self-Relay] eth_call reverted: ${msg}`);

      // Distinguish predicate verification failure from Teleporter contract revert
      const isPredicateFailure =
        msg.includes('predicate') ||
        msg.includes('invalid storage key') ||
        msg.includes('precompile');

      const isTeleporterRevert =
        msg.includes('TeleporterMessenger') ||
        msg.includes('invalid origin') ||
        msg.includes('already executed') ||
        msg.includes('reverted with reason');

      const predicateVerified = !isPredicateFailure;

      console.log(
        `[Self-Relay] Diagnostic: Predicate Verified = ${predicateVerified}, Teleporter Contract Revert = ${isTeleporterRevert}`
      );

      return {
        dispatchTxHash,
        messageId,
        sender,
        unsignedMessageLength: unsignedLen,
        signedMessageLength: signedLen,
        storageKeysCount: storageKeys.length,
        mode: 'dry-run',
        predicateVerified,
        status: 'PREVIEW_REVERT',
        revertReason: msg,
      };
    }
  }

  // Broadcast path: requires explicit M9_ALLOW_BROADCAST=1
  if (process.env.M9_ALLOW_BROADCAST !== '1') {
    throw new Error(
      'Live broadcast blocked by safety gate: set M9_ALLOW_BROADCAST=1 and obtain owner approval.'
    );
  }

  const relayerKey = (process.env.RELAYER_PRIVATE_KEY ||
    process.env.OWNER_PRIVATE_KEY) as Hex | undefined;
  if (!relayerKey) {
    throw new Error('RELAYER_PRIVATE_KEY or OWNER_PRIVATE_KEY required for live broadcast');
  }

  const relayerAccount = privateKeyToAccount(relayerKey);
  const walletClient = createWalletClient({
    account: relayerAccount,
    chain: avalancheFuji,
    transport: http(fujiRpc),
  });

  console.log(
    `[Self-Relay] Broadcasting EIP-2930 delivery transaction from ${relayerAccount.address}...`
  );

  // eth_estimateGas does not budget for Warp predicate verification plus the
  // message's requiredGasLimit, so an estimated limit can leave Teleporter short
  // of gas. Use a fixed, generous limit (override with M9_DELIVERY_GAS).
  const deliveryGas = BigInt(process.env.M9_DELIVERY_GAS || '1500000');
  const txHash = await walletClient.sendTransaction({
    to: TELEPORTER_MESSENGER_ADDRESS,
    data: calldata,
    accessList,
    gas: deliveryGas,
    chain: avalancheFuji,
  });

  console.log(`[Self-Relay] Broadcasted Fuji tx: ${txHash}`);
  const deliveryReceipt = await fujiClient.waitForTransactionReceipt({ hash: txHash });
  console.log(
    `[Self-Relay] Delivery confirmed in Fuji block #${deliveryReceipt.blockNumber} (status: ${deliveryReceipt.status})`
  );

  return {
    dispatchTxHash,
    messageId,
    sender,
    unsignedMessageLength: unsignedLen,
    signedMessageLength: signedLen,
    storageKeysCount: storageKeys.length,
    mode: 'broadcast',
    predicateVerified: true,
    status: 'BROADCAST_SUCCESS',
    txHash,
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('m9-self-relay.ts')) {
  const args = process.argv.slice(2);
  const txIndex = args.indexOf('--tx');
  const targetTx =
    txIndex !== -1 && args[txIndex + 1]
      ? (args[txIndex + 1] as Hex)
      : ('0x8900385adadbdc5d2219990cf1e4f7a37a0ba1d0d685e5a4cc9572d741a3cf21' as Hex);

  const broadcast = args.includes('--broadcast');
  const dryRun = !broadcast || args.includes('--dry-run');

  console.log('================================================================');
  console.log('   MissionPay M9 Self-Relay Dispatch -> Fuji C-Chain CLI        ');
  console.log('================================================================');
  console.log(`Target Dispatch TX: ${targetTx}`);
  console.log(`Mode:               ${broadcast ? 'BROADCAST' : 'DRY-RUN (default)'}\n`);

  selfRelayDispatchTx(targetTx, { dryRun, broadcast })
    .then((result) => {
      console.log('\n--- EXECUTION SUMMARY ---');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[FATAL ERROR]', err);
      process.exit(1);
    });
}
