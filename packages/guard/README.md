# @missionpay/guard

> Deterministic dual-layer cryptographic security guard for autonomous AI agents on Avalanche.

`@missionpay/guard` enforces cryptographic Merkle proofs and spending boundaries before any transaction touches smart contracts. Even if an LLM agent is 100% hijacked via prompt injection, off-mission payouts are deterministically rejected.

---

### 10-Line Quickstart: Cắm vào AI Agent của bạn

```typescript
import { createMissionGuard, TaintRegistry } from '@missionpay/guard';

const guard = createMissionGuard({
  missionId: 'mission-research-01',
  payees: ['0x1111111111111111111111111111111111111111', { address: '0x2222222222222222222222222222222222222222', maxAtomic: 2_000_000n }],
  caps: { perTxCapAtomic: 2_000_000n, missionCapAtomic: 10_000_000n },
});

const taint = new TaintRegistry();
taint.record(webScrapedHtml, 'WEB'); // Taint untrusted tool/web data

const verdict = guard.checkPayment(agentProposal, taint);
if (verdict.outcome !== 'PASS') throw new Error(`Blocked by ${verdict.rule}: ${verdict.reason}`);

const { proposalId } = await guard.simulateOnChain(agentProposal);
console.log('Verified & Guarded Payout:', proposalId);
```

### Build & Test

Build from source via npm:

```bash
# Build TypeScript compiler output to dist/
npm run build

# Run unit tests and PayBench 180-case parity suite
npm run test
```

---

### Dual-Layer Security Model

1. **Layer 1 (Off-Chain Guard):**
   - Provenance Tracking: Data originating from `WEB` or `TOOL_OUTPUT` is tracked. Injected recipients are rejected immediately (`RECIPIENT_UNTRUSTED_PROVENANCE`).
   - Merkle Set Verification: Recipient must exist in the owner-signed Merkle tree (`PAYEE_NOT_IN_MISSION_SET`).
   - Anti-Policy Tampering: Any attempt by the agent to modify daily caps, allowlists, or payee roots is blocked (`AGENT_CANNOT_CHANGE_POLICY`).
2. **Layer 2 (On-Chain Avalanche Smart Contract):**
   - `GuardedTreasury.sol:457`: `require(_verifyMerkle(proof, root, leaf), "PayeeNotInMissionSet")`.
   - Hardware Passkey (RIP-7212 P-256 precompile) & Multi-cap enforcement.
