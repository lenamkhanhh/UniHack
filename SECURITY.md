# Security Policy & Formal Threat Model — MissionPay

> **Notice on Terminology**: MissionPay smart contracts and architecture are **not** "audited" by a third-party audit firm. They have undergone **static analysis (Slither v0.11.6, Aderyn v0.1.9) with findings triaged**, are **formally invariant tested** (Foundry 512 runs / 64 depth), **symbolically property checked** (Halmos / Z3), and **empirically validated** against live prompt injection benchmarks and Avalanche Fuji testnet execution.

---

## 1. Static Analysis (Slither v0.11.6, Aderyn v0.1.9) & Findings Triage

Static security analysis was run with findings triaged across all contracts in `contracts/src/`:
- **Slither Analyzer v0.11.6** (Crytic / Trail of Bits): 9 contracts analyzed with 102 detectors. Output: `evidence/security/slither.txt`.
- **Aderyn v0.1.9** (Cyfrin): AST-level vulnerability detection across all source contracts. Output: `evidence/security/aderyn.md`.

### 1.1 Slither Findings Triage

| Finding ID & Detector | Contract | Description | Triage Classification | Security Rationale & Mitigation |
|---|---|---|---|---|
| `SL-01`: `locked-ether` | `GuardedTreasury.sol` | Contract accepts native AVAX via `receive()` / `fallback()` without a dedicated native AVAX withdraw function. | **Accepted with Rationale** | `GuardedTreasury` is an ERC-20 treasury guard exclusively managing native USDC (`0x5425...`) on Avalanche Fuji / C-Chain. The protocol does not custody or disburse native AVAX; transfers use `USDC.safeTransfer` / `safeTransferFrom`. |
| `SL-02`: `reentrancy-events` | `PasskeyMissionAuthority.sol` | Event `MissionApprovedByPasskey` emitted after calls to `treasury.createMission`, `setMissionPayeeRoot`, `setMissionToolCap`. | **False Positive** | Calls are strictly made to the trusted, immutable `treasury` contract initialized in the constructor. There is no arbitrary external call, no state modification occurs after the calls, and no untrusted reentrancy path exists. |
| `SL-03`: `timestamp` | `GuardedTreasury.sol`, `ValidationRegistry.sol` | Comparison with `block.timestamp` for `expiresAt` checks on missions and proposals. | **Accepted with Rationale** | Required for mission lifespan and proposal time-to-live (TTL). On Avalanche Snowman consensus, block timestamps are strictly monotonic and bound to real time within seconds, preventing miner/validator drift exploitation over hours-long mission windows. |
| `SL-04`: `assembly` / `low-level-calls` | `GuardedTreasury.sol` (`SafeERC20`), `PasskeyMissionAuthority.sol` | Inline assembly for ERC-20 returndata checks; `PRECOMPILE_P256.staticcall` to address `0x100`. | **False Positive** | Standard OpenZeppelin/Solady assembly for gas-efficient, robust ERC-20 compliance, and native RIP-7212 precompile invocation for P-256 WebAuthn signature verification. |
| `SL-05`: `missing-inheritance` | `GuardedTreasury.sol` | `GuardedTreasury` does not explicitly declare `is IGuardedTreasuryAuthority`. | **Accepted with Rationale** | Stylistic check. `GuardedTreasury` implements all interface function selectors (`createMission`, `setMissionPayeeRoot`, `setMissionToolCap`). Contract is already verified and deployed on Fuji. |
| `SL-06`: Informational (`naming-convention`, `unindexed-event-address`, `immutable-states`) | `GuardedTreasury.sol`, `ValidationRegistry.sol` | Style and gas optimization suggestions (`_owner`, `missionCapDefault`, parameter casing). | **Accepted with Rationale** | Informational style conventions that do not impact execution correctness or security invariants. |

### 1.2 Aderyn Findings Triage

| Finding ID & Detector | Contract | Description | Triage Classification | Security Rationale & Mitigation |
|---|---|---|---|---|
| `AD-01`: `H-1` `abi.encodePacked()` collision warning | `PasskeyMissionAuthority.sol` (L210, L221) | `abi.encodePacked` used to build string search patterns (`"challenge":"..."`, `"origin":"..."`). | **False Positive** | The result is not hashed with `keccak256` or used as a storage key. It is strictly used as a contiguous byte pattern to scan for JSON fields inside `clientDataJSON`. Verified by 16/16 Foundry tests including origin prefix bypass attacks. |
| `AD-02`: `H-2` Uninitialized state variables | `GuardedTreasury.sol` (L165), `PasskeyMissionAuthority.sol` (L50) | `nextProposalId`, `nextNonce` declared without explicit `= 0`. | **False Positive** | In the EVM specification, uninitialized `uint256` storage slots default to `0`, which is the intended initial value. |
| `AD-03`: `H-3` Locks Ether without withdraw | `GuardedTreasury.sol` (L88) | Same as Slither `locked-ether`. | **Accepted with Rationale** | GuardedTreasury solely guards ERC-20 assets (USDC). |
| `AD-04`: `L-1` Centralization risk | `GuardedTreasury.sol` | Privileged functions guarded by `onlyOwner`. | **By Design** | Owner is the human budget authorizer (or Passkey hardware authority). The untrusted party is the AI agent; human/passkey authorization of caps and payee sets is the core architectural principle. |
| `AD-05`: `L-2` Unsafe ERC20 operations | `GuardedTreasury.sol` | Manual low-level call in `SafeERC20`. | **False Positive** | Implements the standard `SafeERC20` pattern with boolean check and 32-byte returndata verification. |
| `AD-06`: `L-3` to `L-8` (visibility, constants, scientific notation) | Multiple | Gas and style recommendations. | **Accepted with Rationale** | Code readability and interface compatibility preserved. |

---

## 2. Comprehensive Threat Model

MissionPay secures autonomous AI agent spending across multi-agent tool execution and treasury disbursements. Below is the formal threat model across 6 critical threat vectors:

```
+-------------------------------------------------------------------------------------------------+
|                                       MISSIONPAY DEFENSE LAYERS                                 |
+-------------------------------------------------------------------------------------------------+
| Layer 1: Prompt & Taint Registry (Off-Chain Application)                                        |
|   - Strips client-supplied provenance                                                           |
|   - Ingests untrusted tool outputs into Taint Registry                                          |
|   - Rules: RECIPIENT_UNTRUSTED_PROVENANCE, AGENT_CANNOT_CHANGE_POLICY, AMOUNT_UNTRUSTED         |
+-------------------------------------------------------------------------------------------------+
| Layer 2: Independent Validator & Provenance Engine (Off-Chain / Enforced)                       |
|   - Intercepts all Agent proposals before signing                                               |
|   - Computes Merkle proof against owner-signed payee set                                        |
|   - Enforces per-mission tool budget and treasury caps                                          |
+-------------------------------------------------------------------------------------------------+
| Layer 3: Avalanche Smart Contract Guard (On-Chain / Avalanche Fuji C-Chain)                     |
|   - GuardedTreasury.sol: On-chain Merkle root enforcement (PayeeNotInMissionSet)                |
|   - Hard spending caps (per-tx, daily, mission cap)                                             |
|   - Ephemeral session wallet per mission (fundMissionWallet / sweep)                            |
|   - PasskeyMissionAuthority.sol: WebAuthn P-256 hardware authorization (RIP-7212 0x100)         |
+-------------------------------------------------------------------------------------------------+
```

### Threat 1: Agent Compromised / Prompt Injection (Off-Mission Payee or Inflated Amount)
- **Threat Vector**: An attacker injects malicious instructions via untrusted tool outputs (e.g., search results, web pages, poisoned invoices, or lateral diversion to known account counterparties as in NOMOS arXiv:2610.11030). The LLM planner is 100% tricked and outputs a financial disbursement proposal to the attacker's address or for an unauthorized amount.
- **Mitigation Architecture**:
  1. *Off-chain Taint Tracking*: Untrusted tool strings are extracted into a session Taint Registry; client provenance claims are discarded. Any payee originating from web/tool text is flagged `TOOL_OUTPUT`/`WEB` and blocked with `RECIPIENT_UNTRUSTED_PROVENANCE`.
  2. *Cryptographic Mission Payee Sets*: The owner signs an explicit allowlist of authorized payees for each mission. An on-chain Merkle root (`missionPayeeRoot`) is stored in `GuardedTreasury.sol`.
  3. *On-chain Cryptographic Gate*: If the agent bypasses off-chain validators and calls `proposeWithProof` on-chain, the transaction reverts with `PayeeNotInMissionSet` unless a valid Merkle proof is provided.
- **Test & Proof Evidence**:
  - `apps/web/tests/attack-scoring.test.ts`: Vitest suite verifies 100% block rate across NOMOS known-payee diversion cases.
  - `ATTACK_EVAL.md` & `eval/runs/known-payee-*.json`: Multi-model benchmark (Gemini 3.5 Flash Lite & Gemini 3.1 Flash Lite) demonstrates 0.0% ASR for MissionPay (C2) with 10/10 zero-gas `eth_call` reverts on live Fuji testnet.
  - `contracts/test/invariant/GuardedTreasury.invariant.t.sol`: Invariant `invariant_disbursementRequiresMerkleProof` verified across 512 fuzzed runs.
- **Residual Risk & Stated Limitations**: If an authorized vendor in the mission's owner-signed set turns rogue or their address is compromised outside of MissionPay, payments within the signed cap to that address will succeed.

---

### Threat 2: Agent Session Private Key Leaked
- **Threat Vector**: The host machine running the agent process is compromised, or memory inspection leaks the agent's private signing key.
- **Mitigation Architecture**:
  1. *Per-Mission Ephemeral Session Wallets*: The agent never holds custody of the main treasury or broad organizational allowances. Each mission uses a distinct session wallet funded with strictly `toolCap` USDC via `GuardedTreasury.fundMissionWallet`.
  2. *Bounded Loss Guarantee*: If the agent key is leaked, the maximum possible loss is strictly bounded by the remaining unspent `toolCap` of that specific active mission.
  3. *Treasury Inaccessibility*: The agent key cannot call `execute`, `approve`, or alter any parameters in `GuardedTreasury.sol`. All treasury disbursements require owner signature or queued timelock.
- **Test & Proof Evidence**:
  - `contracts/test/GuardedTreasury.t.sol`: `test_C11_agent_calling_owner_functions_reverts` (agent cannot invoke privileged owner functions), `test_C12_no_direct_agent_transfer_path` (agent has no direct ERC-20 transfer path), `test_SW03_fund_without_toolcap_or_over_toolcap_reverts` (wallet funding is bounded strictly to mission `toolCap`), and `test_P1A_fund_mission_wallet_success` (bounded session wallet allocation).
  - `contracts/test/halmos/GuardedTreasury.halmos.t.sol`: Symbolic proof proving that non-owner callers cannot modify caps, allowlists, or roots.
- **Residual Risk & Stated Limitations**: Any remaining USDC residing in the ephemeral session wallet before the mission is closed/swept can be spent by the possessor of the session key.

---

### Threat 3: Backend Application Server Compromised
- **Threat Vector**: An adversary achieves full remote code execution (RCE) on the Next.js / Node.js application server. The database, taint registry, and environment variables are accessible to the attacker.
- **Mitigation Architecture**:
  1. *No Custody of Owner Key*: The backend application server never holds or stores the owner's private key (`OWNER_PRIVATE_KEY` / deployer key). Owner actions require hardware Passkey WebAuthn signatures or separate client-side EIP-191 / Core wallet signing.
  2. *Immutable On-Chain Constraints*: Even if the backend server fabricates proposals, alters database records, and feeds valid proofs to the agent, the smart contract on Avalanche enforces `perTxCap`, `dailyCap`, and `missionCap`.
  3. *On-Chain Audit Anchoring*: Audit logs are committed via cryptographic hash chains. The root is periodically anchored on Avalanche (`anchorMissionProof`). Once anchored on-chain, tampering with historic audit entries breaks client-side verification at `/verify/[missionId]`.
- **Test & Proof Evidence**:
  - `tests/provenance.test.ts`: Re-verifies hash chain integrity; tampering with 1 byte in the audit log triggers client-side verification failure.
  - Live Fuji Tx [`0x43bd...0547`](https://testnet.snowtrace.io/tx/0x43bdc60b5a32eb51817e040ffb4a5359489502b489a274db288b8e058c420547): Proof anchor on Avalanche Fuji verified matching client-recomputed state.
- **Residual Risk & Stated Limitations**: A compromised server could cause denial of service (refusing to relay valid tasks) or spend within the remaining daily cap of pre-approved mission recipients until paused by the owner.

---

### Threat 4: Facilitator (Ultravioleta / PayAI) Acting Maliciously
- **Threat Vector**: In x402 micropayments, the third-party settlement facilitator alters the payment recipient, inflates the payment amount, front-runs settlements, or attempts double-spending of authorization signatures.
- **Mitigation Architecture**:
  1. *EIP-3009 Cryptographic Authorization*: The session wallet signs an exact `TransferWithAuthorization` specifying `from`, `to` (the tool seller), `value` (exact price in atomic USDC), `validAfter`, `validBefore`, and a unique `nonce`.
  2. *Request-Bound Nonces (ATC'26 Hardening)*: Nonces are deterministically computed via `lib/x402-binding.ts`:
     $$\text{nonce} = \text{keccak256}(\text{"MissionPay-x402-bind-v1"}, \text{keccak256}(\text{operationId}), \text{keccak256}(\text{endpoint}), \text{inputHash}, \text{price}, \text{payTo}, \text{chainId})$$
     A facilitator cannot redirect authorization to another seller or replay it on another endpoint without invalidating the cryptographic signature.
  3. *Idempotent Settlement Tracking*: `(chainId, asset, authFrom, authNonce)` are indexed with a unique constraint in the database, preventing double settlement.
- **Test & Proof Evidence**:
  - `tests/x402-atc26.test.ts`: Validates complete defense against all 4 vulnerability classes from ACM SIGOPS ATC '26 (Ling et al., arXiv:2605.30998).
  - Live Fuji Tx [`0x8c89...8208`](https://testnet.snowtrace.io/tx/0x8c897f9c26f6341fbbdc553cb7b1154c46f3456bb0122e28a504efea4e518208): Verified settlement executed via Ultravioleta facilitator with correct parameters.
- **Residual Risk & Stated Limitations**: A malicious facilitator could censor settlements (refuse to submit them to Avalanche), causing payment timeouts. The client mitigates this via automatic failover to secondary facilitators (PayAI) or direct on-chain settlement.

---

### Threat 5a: Off-Chain Policy Validator Compromised
- **Threat Vector**: The off-chain policy validator in the application backend (`lib/validator.ts`) is compromised, tampered with, or bypassed, outputting a falsified `PASS` verdict for an unauthorized transaction.
- **Mitigation Architecture**:
  1. *Dual-Layer Enforcement*: Off-chain validators serve solely as a pre-flight UX filter and simulation layer. The smart contract never trusts off-chain validator assertions for state transitions.
  2. *Immutable Smart Contract Invariants*: `GuardedTreasury.sol` on Avalanche independently executes on-chain Merkle verification:
     ```solidity
     require(_verifyMerkle(proof, root, leaf), "PayeeNotInMissionSet");
     ```
     (calling internal function `_verifyMerkle` at line 457) and enforces `spent + amount <= missionCap`. Even with 100% off-chain validator compromise, the smart contract on-chain reverts any illegal transfer.
- **Test & Proof Evidence**:
  - `contracts/test/GuardedTreasury.t.sol`: `test_PV1_proposeWithProof_invalid_proof_or_unauthorized_payee_reverts` (on-chain revert `PayeeNotInMissionSet` regardless of off-chain simulation status).
  - `contracts/test/invariant/GuardedTreasury.invariant.t.sol`: `invariant_payeeAlwaysInRoot` fuzzed across 512 runs / 32,768 calls without a single invalid payee disbursement.
- **Residual Risk & Stated Limitations**: A compromised off-chain validator could falsely reject valid proposals (denial of service), halting mission execution, but cannot extract unauthorized treasury funds.

---

### Threat 5b: ERC-8004 Post-Mission Validator Key Compromised (`0x83F5…13B5`)
- **Threat Vector**: The private key of the post-mission ERC-8004 validator (`0x83F53eE2b62A512d7d6b38c227447783D99513B5`) is compromised by an adversary.
- **Mitigation Architecture**:
  1. *Registry Architecture Distinction*: Avalanche Fuji hosts official ERC-8004 registries only for Identity (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) and Reputation (`0x8004B663056A597Dffe9eCcC1965A193B7388713`). There is NO official Avalanche Fuji ValidationRegistry. MissionPay deploys a custom open-source port of `ValidationRegistry.sol` (derived from `ava-labs/8004-boilerplate`, MIT) at `0x4c5ccda2a630cd1cb706799deadcc8483d06697e`.
  2. *Attestation-Only Decoupling*: The ERC-8004 validation score is an informational, post-mission public attestation. It has zero custody over treasury funds and zero ability to authorize, trigger, or unpause disbursements in `GuardedTreasury.sol`.
- **Test & Proof Evidence**:
  - `contracts/test/ValidationRegistry.t.sol`: 7 unit tests verifying validator authorization, request hash binding, and score bounds.
  - Live Fuji Tx [`0xb641353c...`](https://testnet.snowtrace.io/tx/0xb641353ca4922115ec66c7504f2f056ec136aa3e877a5611f01c905efbfe8059): Validation response on deployed `ValidationRegistry` (`0x4c5c...`).
- **Residual Risk & Stated Limitations**: An adversary holding the validator key (`0x83F5…13B5`) can post a fraudulent 100/100 validation score for an incorrectly executed or malicious mission. This score is purely an attestation and does not protect or disburse funds; users must independently verify execution via `/verify/[missionId]` or re-run `scripts/validator-run.ts`.

---

### Threat 6: Passkey WebAuthn Phishing / Origin Spoofing / Signature Replay
- **Threat Vector**: An attacker lures the owner to a phishing domain (`phish-missionpay.com` or `localhost:3100.attacker.com`) to sign a WebAuthn assertion, or attempts high-S signature malleability / replay.
- **Mitigation Architecture**:
  1. *PasskeyMissionAuthority.sol Hardening (PK-F1)*:
     - Exact `rpIdHash` check: Verifies `authenticatorData[0:32] == rpIdHash`.
     - Exact origin matching with closing quote: Scans `clientDataJSON` for `"origin":"<expectedOrigin>"` with closed quotation, defeating subdomain prefix bypass attacks.
     - Mandatory User Verification (UV flag, bit 2) and User Presence (UP flag, bit 0).
     - Cross-origin rejection: Reverts if `crossOrigin: true` is present.
     - Anti-malleability: Enforces $s \le N/2$ for SECP256R1 curve order.
  2. *Native Avalanche RIP-7212 Precompile*: Hardware P-256 verification executes directly on Avalanche C-Chain precompile `0x100`, eliminating complex or vulnerable custom Solidity math libraries.
  3. *Replay Nonce*: Incremental `nextNonce` prevents replay of previous assertions.
- **Test & Proof Evidence**:
  - `contracts/test/PasskeyMissionAuthority.t.sol`: 8 dedicated security tests pass:
    - `test_wrongRpIdHash_reverts`
    - `test_phishingOrigin_reverts`
    - `test_originPrefixTrick_reverts`
    - `test_userPresentWithoutVerification_reverts`
    - `test_registrationCeremonyAsAssertion_reverts`
    - `test_highS_reverts`
    - `test_crossOriginTrue_reverts`
    - `test_rotatePasskey_requiresSameChecks`
  - Live Fuji Tx [`0x494b...a929`](https://testnet.snowtrace.io/tx/0x494b664be33d2c2d08575884f3ceb546779e8c7eb8eaec0bed171a11f0d7a929): Verified hardware WebAuthn mission approval on Avalanche Fuji using native precompile `0x100`.
- **Residual Risk & Stated Limitations**: The initial authority instance is bound to the immutable `rpIdHash` and `expectedOrigin` configured at deployment. Deploying to a new public domain requires deploying a corresponding authority instance for that origin.

---

## 3. Invariant & Formal Verification Alignment

| Invariant ID | Target Contract | Formal Description | Verification Method | Proof Artifact |
|---|---|---|---|---|
| `INV-1` | `GuardedTreasury` | $\forall m, \text{spent}(m) \le \text{cap}(m)$ | Foundry Invariant (512 runs, 64 depth) | `evidence/formal/invariant.txt` |
| `INV-2` | `GuardedTreasury` | Nonce uniqueness & monotonic progression | Foundry Invariant | `contracts/test/invariant/` |
| `INV-3` | `GuardedTreasury` | Disbursement requires valid Merkle proof when root is set | Halmos Symbolic Execution & Mutant Testing | `evidence/formal/mutant.txt` |
| `INV-4` | `PasskeyMissionAuthority` | Origin & RP ID verification cannot be bypassed | Foundry Unit & Mutation tests | `PasskeyMissionAuthority.t.sol` |
| `INV-5` | `x402-binding` | Request binding nonce collision resistance | Vitest ATC'26 test suite (F1-F4) | `tests/x402-atc26.test.ts` |

---

## 4. Responsible Disclosure

If you identify a security vulnerability in MissionPay contracts or infrastructure:
1. Do **not** open a public issue.
2. Email the maintainers directly with details, reproduction steps, and proof-of-concept scripts.
3. Allow up to 48 hours for acknowledgment and coordinated disclosure scheduling.
