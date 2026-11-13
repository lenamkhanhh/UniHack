# Spike: Self-Relaying Avalanche ICM Warp Messages (Dispatch -> Fuji)

**Date:** 2026-11-13  
**Status:** Completed Spike (P1-B Step 0)  
**Target Milestone:** P1-B (ICM Live via Self-Relay)  
**Authors:** MissionPay Core Architecture Team  

---

## 1. Executive Summary & Verdict

### Verdict: **CONDITIONAL GO** (Timeboxed to 16–17 Nov 2026)

Self-relaying Avalanche Inter-Chain Messaging (ICM) transactions from **Dispatch L1 (`Chain ID 779672`)** to **Avalanche Fuji C-Chain (`Chain ID 43113`)** is architecturally sound and eliminates reliance on unmaintained public testnet relayers. 

The mechanism utilizes:
1. **Source Transaction on Dispatch**: `MissionSpendGateway.sendSpendRequest(...)` triggers Teleporter and the Warp Precompile (`0x0200000000000000000000000000000000000005`), emitting an unsigned Avalanche Warp Message log.
2. **BLS Signature Aggregation via Ava Labs Glacier API**: Querying Ava Labs' hosted Signature Aggregator service (`https://glacier-api.avax.network/v1/signatureAggregator/testnet/aggregateSignatures`) to collect validator BLS signatures into an aggregated multi-signature payload without running local validator nodes.
3. **Access-List Delivery on Fuji**: The caller (our self-hosted relayer script) submits an EIP-2930 access-list transaction directly to `TeleporterMessenger.receiveCrossChainMessage(messageIndex, relayerRewardAddress)` on Fuji C-Chain, packing the signed Warp message into the transaction access list for cryptographic validation by Fuji's native Warp precompile.

### Funding & Prerequisite Requirements for Owner
1. **Dispatch Gas Faucet (5 minutes)**: Owner must claim testnet `DISPATCH` tokens from the Builder Hub / Core Faucet (`https://core.app/tools/testnet-faucet/?subnet=dispatch`) for ví Owner (`0x4BC93356C180Ba2Dd13A4a1Cf43405Bd0eb58F7c`) and ví Agent (`0x84fEE0570b5C158866B599bA905a39626DfeF217`).
2. **Fuji Gas (Already Funded)**: Ví Relayer (`0xE90cf574D332658f9dfB950d899610Fb2F6e1aEA`) has `0.02 AVAX` on Fuji, sufficient for ~20 delivery transactions.
3. **Glacier API Key (Free Tier)**: Generate a free Glacier API Key on [AvaCloud Portal](https://avacloud.io) or [Avalanche Builder Hub](https://build.avax.network) to authorize requests to `glacier-api.avax.network`.

---

## 2. Technical Architecture & Message Lifecycle

```
 +-----------------------------------------------------------------------------------+
 | 1. Dispatch L1 (Source Chain ID: 779672)                                          |
 |    Agent calls: MissionSpendGateway.sendSpendRequest(missionId, payee, amount)   |
 |        │                                                                          |
 |        ▼                                                                          |
 |    TeleporterMessenger.sendCrossChainMessage(...)                                 |
 |        │                                                                          |
 |        ▼                                                                          |
 |    Warp Precompile (0x0200...0005) emits:                                         |
 |    event SendWarpMessage(address sender, bytes32 messageID, bytes unsignedMsg)   |
 +----------------------------------------+------------------------------------------+
                                          │
                                          │ 2. Relayer Script extracts unsignedMsg
                                          ▼
 +-----------------------------------------------------------------------------------+
 | 3. Ava Labs Signature Aggregator (Glacier API)                                    |
 |    POST /v1/signatureAggregator/testnet/aggregateSignatures                       |
 |    Payload: { message: unsignedMsg, quorumPercentage: 67, signingSubnetId: ... }  |
 |        │                                                                          |
 |        ▼                                                                          |
 |    Returns: { signedMessage: "0x..." } (BLS multi-sig over Warp payload)          |
 +----------------------------------------+------------------------------------------+
                                          │
                                          │ 4. Relayer Script packs signedMessage into
                                          │    EIP-2930 Access List
                                          ▼
 +-----------------------------------------------------------------------------------+
 | 5. Avalanche Fuji C-Chain (Destination Chain ID: 43113)                           |
 |    Relayer calls: TeleporterMessenger.receiveCrossChainMessage(0, rewardAddress)  |
 |    Transaction contains accessList: [{                                            |
 |        address: "0x0200000000000000000000000000000000000005",                   |
 |        storageKeys: [packWarpIntoStorageKeys(signedMessage)]                     |
 |    }]                                                                             |
 |        │                                                                          |
 |        ▼                                                                          |
 |    Warp Precompile on Fuji cryptographically validates BLS aggregate signature    |
 |        │                                                                          |
 |        ▼                                                                          |
 |    TeleporterMessenger delivers payload to MissionBudgetHub.receiveTeleporterMsg  |
 |        │                                                                          |
 |        ▼                                                                          |
 |    MissionBudgetHub calls GuardedTreasury.proposeWithProof / executes payout      |
 +-----------------------------------------------------------------------------------+
```

---

## 3. Official Documentation & SDK Citations

1. **Avalanche Teleporter / ICM Contracts Repository**:
   - Upstream Repo: [`ava-labs/icm-contracts`](https://github.com/ava-labs/icm-contracts) (formerly `ava-labs/teleporter`).
   - Contract Specification: `contracts/teleporter/TeleporterMessenger.sol`.
   - Method Signature:
     ```solidity
     function receiveCrossChainMessage(
         uint32 messageIndex,
         address relayerRewardAddress
     ) external receiverNonReentrant;
     ```
   - Core Mechanism: The Warp Messenger precompile (`0x0200000000000000000000000000000000000005`) inspects transaction access list entries matching its address and extracts the verified payload via `getVerifiedWarpMessage(messageIndex)`.

2. **Ava Labs Glacier Data API Specification**:
   - Official Documentation: [`docs.avax.network/api-reference/data-api/signature-aggregator`](https://docs.avax.network/api-reference/data-api/signature-aggregator).
   - Base URL: `https://glacier-api.avax.network/v1/signatureAggregator/{network}/aggregateSignatures`
   - Network Parameter: `testnet` (for Fuji and Dispatch Subnet).

---

## 4. Exact API Request & Response Shapes

### 4.1 Signature Aggregation Request
```http
POST https://glacier-api.avax.network/v1/signatureAggregator/testnet/aggregateSignatures
Content-Type: application/json
x-glacier-api-key: <OWNER_GLACIER_KEY>
```

#### Request JSON Payload:
```json
{
  "message": "0x<hex_encoded_unsigned_warp_message_bytes>",
  "justification": "0x",
  "signingSubnetId": "2D8RG4US5VP6ZsCTwS5Zp4C3jS7jW8q9W7vT1",
  "quorumPercentage": 67,
  "quorumPercentageBuffer": 10,
  "pChainHeight": 0
}
```

*Notes on Parameters:*
- `message`: Extracted directly from `receipt.logs` matching `SendWarpMessage` emitted by `0x0200000000000000000000000000000000000005`.
- `quorumPercentage`: Default `67` (two-thirds validator weight required by Avalanche consensus).
- `pChainHeight`: `0` indicates the latest proposed P-chain block height at message issuance.

#### Response JSON Payload:
```json
{
  "signedMessage": "0x<hex_encoded_aggregate_signed_warp_message>"
}
```

---

## 5. Viem / SDK Helper for Predicate Access List Packing

In Avalanche Subnet-EVM, signed Warp messages are passed to destination smart contracts via the standard EIP-2930 `accessList`.

### 5.1 Packing Algorithm
The Avalanche Subnet-EVM precompile parses the access list targeting `0x0200000000000000000000000000000000000005`. The raw `signedMessage` bytes are serialized into 32-byte storage keys:
1. First storage key (`storageKeys[0]`): contains the 4-byte big-endian message length followed by initial bytes.
2. Subsequent storage keys: contain consecutive 32-byte slices of the remaining payload.

### 5.2 TypeScript Implementation (`viem`)
```typescript
import { Hex, Address, pad, toHex } from 'viem';

export const WARP_PRECOMPILE_ADDRESS: Address =
  '0x0200000000000000000000000000000000000005';

export interface AccessListEntry {
  address: Address;
  storageKeys: Hex[];
}

/**
 * Packs raw signed Avalanche Warp message bytes into EIP-2930 storage keys
 * expected by the Avalanche Warp precompile.
 */
export function packWarpMessageToAccessList(signedMessageHex: Hex): AccessListEntry[] {
  const cleanHex = signedMessageHex.startsWith('0x')
    ? signedMessageHex.slice(2)
    : signedMessageHex;
  const messageBytes = Buffer.from(cleanHex, 'hex');
  const length = messageBytes.length;

  // Header key: 4-byte length prefix + first 28 bytes
  const headerBuf = Buffer.alloc(32);
  headerBuf.writeUInt32BE(length, 0);
  messageBytes.copy(headerBuf, 4, 0, Math.min(28, length));

  const storageKeys: Hex[] = [(`0x${headerBuf.toString('hex')}`) as Hex];

  // Remaining chunks (32 bytes each)
  let offset = 28;
  while (offset < length) {
    const chunk = Buffer.alloc(32);
    messageBytes.copy(chunk, 0, offset, Math.min(offset + 32, length));
    storageKeys.push((`0x${chunk.toString('hex')}`) as Hex);
    offset += 32;
  }

  return [
    {
      address: WARP_PRECOMPILE_ADDRESS,
      storageKeys,
    },
  ];
}
```

### 5.3 Destination Delivery Call (`viem`)
```typescript
const deliveryTxHash = await relayerWalletClient.sendTransaction({
  to: TELEPORTER_MESSENGER_ADDRESS, // 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf
  data: encodeFunctionData({
    abi: TELEPORTER_MESSENGER_ABI,
    functionName: 'receiveCrossChainMessage',
    args: [
      0, // messageIndex (0-th warp message in accessList)
      relayerWalletClient.account.address, // relayerRewardAddress
    ],
  }),
  accessList: packWarpMessageToAccessList(signedMessage),
  chain: avalancheFuji,
});
```

---

## 6. Implementation Plan & Operating Boundaries (P1-B)

| Step | Action | Responsibility | Target Date |
|---|---|---|---|
| **Step 0** | Architecture spike & documentation (`docs/m9-self-relay-spike.md`) | Claude / Gemini | **13 Nov (Done)** |
| **Step 1** | Faucet funding for Dispatch testnet ví Owner & Agent | Owner | 14–15 Nov |
| **Step 2** | Deploy `MissionSpendGateway` on Dispatch and `MissionBudgetHub` on Fuji | Gemini | 16 Nov |
| **Step 3** | Implement standalone relayer script `scripts/m9-self-relay.ts` | Gemini | 16 Nov |
| **Step 4** | Execute live cross-chain test (1 valid spend + 1 rejected stranger spend) | Gemini | 16–17 Nov |
| **Step 5** | Record on-chain receipts into `evidence/m9/icm-live.json` | Gemini | 17 Nov |

### Hard Safety Gate
If by **17 Nov 2026 23:59 ICT**, Dispatch faucet tokens or Glacier signatures cannot be acquired on testnet:
- **Decision:** Trigger NO-GO fallback.
- **Action:** Preserve the verified Foundry test suite (`MissionCrossChainICMTest`, 12/12 pass) and local fork simulator. Retain transparent "Roadmap-staged" disclosure in README.md Section 2 without claiming live testnet settlement.
