# MissionPay (Guarded Agent Economy)

> **"Giao cho AI agent một nhiệm vụ và một ngân sách. Avalanche bảo đảm nó không tiêu quá, và bạn thấy từng đồng đi đâu."**  
> *(Give your AI agent a mission and a budget. Avalanche makes sure it can't overspend — and shows you every cent.)*

- **Verification Status**: S1 Payment & Audit Slice Verified; Stage S2 Lifecycle Wired (fund / anchor / feedback); x402 Hardening (ATC'26) Completed; Reviewer Fixes A1–A8 Completed.
- **Test Suite**: **277 passed / 1 skipped Vitest tests** across 32 test files in `apps/web` on PostgreSQL 16 + PGlite, and **19/19 Vitest tests** in `@missionpay/guard`.
- **Smart Contracts**: **111/111 Foundry tests pass** across 6 suites in `contracts/test/` (43 GuardedTreasury with A1 root snapshot checks, 32 PasskeyGovernance with A3 owner actions, 16 PasskeyMissionAuthority, 12 MissionCrossChainICM, 7 ValidationRegistry, and 1 GuardedTreasuryInvariant suite with 6 stateful properties fuzzed over 512 runs / 32,768 calls).
- **Python Benchmark**: **8/8 unit tests pass** in `eval/agentdojo/test_provguard_pairs.py` with process-isolated hard timeout termination and provenance fingerprinting.
- **ERC-8004 Support**: Pinned and verified against official Fuji Identity (`0x8004A818...`) and Reputation (`0x8004B663...`) registries.
- **Proof Verifier**: Standalone cryptographic verifier pass (`scripts/verify-proof.ts`, keccak256 hash-chaining + checkpoint matching).
- **On-Chain Deployment Notice**: Smart contract patches in `contracts/src/` are tested and verified locally. The existing Fuji deployment (`0x2045...`) is the historical deployment and does NOT yet reflect these new patches. Live Fuji deployment is pending explicit owner authorization.

---

## Quick Runbook: Reproducing the Local MOCK Vertical Flow

This guide reproduces the complete S1 vertical lifecycle against an isolated PostgreSQL 16 database and Next.js web application without relying on external testnet faucet AVAX or live gas.

### 1. Prerequisites & Environment Setup

- Node.js >= 20.x, npm >= 10.x, Python >= 3.10, Foundry (`forge`)
- Dedicated PostgreSQL 16 database running locally on port `55432`

#### A. Local Development & MOCK Mode Configuration (.env.local)

```bash
# Core Database Connections (disposable test database)
DATABASE_URL="postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test"
DIRECT_URL="postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test"

# Runtime & Security Configuration
APP_ORIGIN="http://localhost:3100"
DEPLOYMENT_ID="unihack-test-deployment"
PAYMENT_MODE="MOCK"

# Cryptographic Seeds (SW-01: Must be distinct and >= 32 characters)
MISSION_TOKEN_SECRET="test-mission-token-secret-must-be-at-least-32-chars-long!"
SESSION_WALLET_SEED="test-isolated-session-wallet-seed-must-be-distinct-32chars!"

# Standard Test Fixture Addresses (Hardhat / Anvil default accounts - LOCAL MOCK ONLY)
OWNER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
SELLER_ADDRESS="0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
AGENT_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
```

#### B. Mandatory Environment Variables for LIVE Mode (`PAYMENT_MODE="LIVE_FUJI"`)

> [!CAUTION]
> **Production / Fuji Testnet Security Guardrails (SW-01 & KEY-01/02):**
> When `PAYMENT_MODE="LIVE_FUJI"`, `validateLiveFujiConfig()` executes strict pre-flight checks on server boot. It **aborts immediately** if any of the following conditions are met:
> 1. `SESSION_WALLET_SEED` is missing, shorter than 32 characters, identical to `MISSION_TOKEN_SECRET`, or matches any known dev/sample placeholder.
> 2. `OWNER_ADDRESS` or `AGENT_PRIVATE_KEY` matches known Anvil/Hardhat test fixture keys.
> 3. Required contract addresses or live RPC URLs are omitted.

| Variable Name | Required Value Specification | Purpose & Enforcement |
|---|---|---|
| `PAYMENT_MODE` | `"LIVE_FUJI"` | Activates live Avalanche Fuji testnet settlement rails. |
| `DATABASE_URL` | Valid PostgreSQL URL with pool | Hosted production database (e.g. Neon / Supabase). |
| `DIRECT_URL` | Direct PostgreSQL connection URL | Prisma migrations without connection pooling. |
| `APP_ORIGIN` | `https://your-domain.vercel.app` | CORS & EIP-712 domain verification. |
| `DEPLOYMENT_ID` | High-entropy UUID / random hex | Session wallet HKDF salt and authorization domain tag. |
| `MISSION_TOKEN_SECRET` | High-entropy random string (>= 32 chars) | Signs short-lived Spend JWT tokens. **Never shared with wallet seed.** |
| `SESSION_WALLET_SEED` | High-entropy random string (>= 32 chars) | Master HKDF seed for deriving task-isolated session wallet private keys. |
| `AVALANCHE_FUJI_RPC_URL`| e.g. `https://api.avax-test.network/ext/bc/C/rpc` | Reliable C-Chain JSON-RPC endpoint. |
| `GUARDED_TREASURY_ADDRESS`| `0x...` (deployed contract) | Address of verified `GuardedTreasury.sol` on Fuji. |
| `OWNER_ADDRESS` | Live Owner EOA | Signs mission creation, activation, and complete challenges. Must not be Anvil key. |
| `AGENT_PRIVATE_KEY` | Live Agent EOA Private Key | Signs tool payment authorizations. Must not be Anvil key. |
| `SELLER_ADDRESS` | Live Seller / Facilitator EOA | Tool payment recipient address. |

### 2. Database Migrations

Apply Prisma migrations to the local test database:

```bash
cd apps/web
npx prisma migrate deploy
```

### 3. Start the Web Application

Launch the Next.js development server on port 3100:

```bash
npm run dev -- -p 3100
```

### 4. Execute the Interactive Demo Flow

1. Open your browser and navigate to `http://localhost:3100/demo`.
2. Connect your test wallet (MetaMask) or use the automated Playwright runner.
3. Click **"Execute Live S1 Flow"**.

### 5. Step Interpretation & Accounting Breakdown

The interactive demo executes 8 sequential phases against live API route handlers and PostgreSQL:

| Step | Action | Detail & Accounting |
|---|---|---|
| **1. Policy** | `GET /api/policy` | Verifies runtime status: `Stage=S1`, `PaymentMode=MOCK`, `ChainID=43113` (Avalanche Fuji). |
| **2. Challenge** | `POST /api/auth/challenge` | Requests an EIP-191 challenge nonce for action `CREATE_MISSION` signed by Owner. |
| **3. Create** | `POST /api/missions` | Persists mission with dual caps: **10.00 USDC Treasury Cap**, **5.00 USDC Tool Cap**. Status: `CREATED`. |
| **4. Activate** | `POST /api/missions/[slug]/activate` | Signs `ACTIVATE` payload with Owner key; backend issues a scoped Spend JWT token. |
| **5. Search** | `POST /api/tools/orchestrate` | Agent spends **0.10 USDC** tool budget on research search. Operation settles idempotently (`state: SETTLED`). |
| **6. TalkMeter** | `POST /api/tools/talkmeter/tick` | Demonstrates continuous resource metering (**0.05 USDC / min**). When a premature tick is sent before 60 seconds elapse, the server rejects it with **HTTP 400** (`elapsed < 60s`), preventing premature billing. Session is then cleanly stopped. |
| **7. Complete** | `POST /api/missions/[slug]/complete` | Computes dynamic `deliverableHash` (SHA-256) over returned search results; transitions mission to `COMPLETED`. |
| **8. Scoped Proof**| `GET /api/missions/[slug]/proof` | Exports cryptographic proof bundle containing keccak256 hash-chain and database checkpoint. |

### 6. Export & Verify Mission Proof Out-of-Band

Export the mission proof JSON from `/api/missions/[slug]/proof` and run the standalone verification script:

```bash
npx tsx scripts/verify-proof.ts .cache/mission-proof.json
```

Expected output:
```text
PASS: All 3 entries verified. Head hash: 0x89cc4ac037c364802a87045bb50ef6726d37d578749b51e95ffc7a6d152d2b31
```

The verifier independently checks:
- Strict chain continuity (`prevHash[i] == entryHash[i-1]`).
- Canonical JSON keccak256 hash integrity.
- Consistency between inner JSON payloads and outer database envelope attributes.
- Final head hash and entry count matching the database checkpoint.

---

## Scope Boundaries & Status Summary

| Component | Status | Verification Evidence |
|---|---|---|
| **x402 Gasless Micropayments (Off-Chain)** | **VERIFIED** | Unit + API handler tests verify reservation, settlement, idempotency, and recovery. |
| **Database Persistence (PostgreSQL 16)** | **VERIFIED** | 101 Vitest cases run directly against live PostgreSQL daemon on port 55432 & PGlite. |
| **Unmocked Browser E2E** | **VERIFIED** | Playwright real-integration spec passes against live backend & DB. |
| **Cryptographic Proof Verifier** | **VERIFIED** | Standalone CLI verifier validates hash-chain and database checkpoint. |
| **GuardedTreasury & Passkey Smart Contracts (S2)** | **COMPILED & VERIFIED** | Smart contracts in `contracts/src/`, **111/111 Foundry tests pass** (`contracts/test/`). Includes A1 root snapshot enforcement, A3 passkey owner governance actions, and 6 stateful invariants. *(Lưu ý: Triển khai Fuji lịch sử `0x2045...` chưa cập nhật các bản vá mới này).* |
| **Passkey UI & WebAuthn Relay** | **VERIFIED (LOCAL CRYPTO BOUNDARY)** | Exact P-256 software verification and virtual authenticators verified in tests (`webauthn-p256.test.ts`, `passkey-relay.test.ts`). Live physical biometric hardware prompt on Fuji is marked `NOT_RUN` (pending live hardware owner signoff). |
| **ERC-8004 Identity & Feedback (S3)** | **VERIFIED & PINNED** | Pinned verified implementation ABIs from Fuji contracts (`0x16e0FA...` and `0x7274e8...`), **11/11 Vitest tests pass** (`erc8004.test.ts`). |
| **Avalanche Fuji Live Settlement** | *PENDING_FUJI* | Requires live testnet RPC, funded Fuji USDC, and explicit owner broadcast approval. Historical Fuji deployment does NOT include new contract patches. |
| **Public Production Deployment** | *PENDING_FUJI* | Production deployment cutover scheduled for Step 6. |

---

## Maximum Potential Loss Bounding (P1-A / SW-01 Security Model)

| Failure / Attack Scenario | Stage S1 Containment | Stage S2 On-Chain Containment (`GuardedTreasury` + Session Wallet) | Maximum Potential Loss |
|---|---|---|---|
| **Agent / Session Key Compromised (SW-01)** | Software validator & DB balance tracking | **Contract-Funded Session Wallet**: Derived via HKDF-SHA256 from dedicated `SESSION_WALLET_SEED`. Treasury transfers only `toolCap` USDC. Gasless EIP-3009 sweep reclaims unspent funds without wallet needing AVAX. | **Strictly bounded to mission `toolCap`** (e.g. 5.00 USDC). Main treasury balance is mathematically unspendable by session key. |
| **Prompt Injection proposing payout** | Strictly blocked by `STAGE_S1_NO_TREASURY` | Contract enforces recipient allowlist and proposal review queue; reverts on Avalanche Fuji | **0 USDC** (unallowlisted recipient payout impossible). |
| **Server / Database Compromised** | Off-chain checks vulnerable | `GuardedTreasury` contract independently enforces per-tx, daily (UTC-reset), and mission caps on-chain | **Bounded by contract daily/mission cap**. Owner emergency pause immediately freezes treasury. |
| **Tool Price-Mismatch (> advertised)** | Price comparison guard blocks payment | Payment authorization not signed | **0 USDC**. |

---

## x402 Protocol Hardening (ATC'26)

Căn cứ nghiên cứu *"Free-Riding the Agentic Web: A Systematic Security Analysis of x402 Payments"*, ACM SIGOPS ATC '26 (Ling et al., [arXiv:2605.30998](https://arxiv.org/abs/2605.30998)), MissionPay đã vá F1, F2, F4; F3 không áp dụng (chỉ dùng scheme `exact`):

| Lớp lỗi (Flaw Class) | Nguy cơ tấn công | Trạng thái | Giải pháp kỹ thuật | Test kiểm chứng |
|---|---|---|---|---|
| **F1: Resource Binding & Parameter Tampering** | Kẻ tấn công lấy chữ ký thanh toán của tài nguyên này (hoặc query này) để đòi kết quả của tài nguyên đắt hơn hoặc tráo đổi query (`Cross-Resource Free-Riding`). | **ĐÃ VÁ** | **Request-Bound EIP-3009 Nonce** (`computeBoundNonce` trong `lib/x402-binding.ts`): Nonce EIP-3009 không còn là số ngẫu nhiên mà được tính bằng $\text{keccak256}(\text{encodeAbi}(\text{version}, \text{opId}, \text{POST /api/tools/} + \text{toolId}, \text{inputHash}, \text{price}, \text{payTo}, \text{chainId}))$. Seller route tính lại và trả ngay **HTTP 403 `PAYMENT_NOT_BOUND_TO_REQUEST`** trước khi gọi upstream nếu phát hiện lệch. | `tests/x402-atc26.test.ts` (F1a, F1b, F1c với deterministic test vector) |
| **F2: Concurrent Replay & Double Settlement** | Kẻ tấn công gửi nhiều request song song với cùng một header `X-PAYMENT` để cố tình kích hoạt thanh toán lặp hoặc nhận nhiều dịch vụ (`Double-Spending`). | **ĐÃ VÁ** | Ràng buộc duy nhất `@@unique([chainId, asset, authFrom, authNonce])` trên bảng `ToolOperation` trong PostgreSQL, kết hợp Atomic CAS Claim Lease (`workerLeaseOwner`) và xử lý idempotent. Đúng 1 lần settle được chấp thuận, không bao giờ trừ tiền gấp đôi. | `tests/x402-atc26.test.ts` (F2), `tests/p-series.test.ts` (P20, P22) |
| **F3: Overdraft via `upto` Scheme** | Kẻ tấn công lợi dụng cơ chế ủy quyền mở `upto` để rút vượt số dư hoặc tiêu lạm quỹ. | **KHÔNG ÁP DỤNG** | MissionPay **chỉ hỗ trợ duy nhất cơ chế `exact`** (tuyệt đối không dùng `upto`). Toàn bộ luồng thanh toán quy định số tiền chính xác, được khóa bởi hạn mức nhiệm vụ (`toolCap`). | Thiết kế kiến trúc (`pipeline/02-x402-tools.md`, `contracts/src/GuardedTreasury.sol`) |
| **F4: Premature Result Disclosure** | Seller trả kết quả upstream trước khi giao dịch thanh toán thực sự được xác nhận trên chain (`Settlement Gating`). Kẻ tấn công có thể hủy ủy quyền để nhận tài nguyên miễn phí. | **ĐÃ VÁ** | **Atomic Result Gating**: Kết quả tính toán (`heldResult`) được mã hóa lưu trữ tạm thời trong DB và **chỉ được giải phóng cho client khi giao dịch đạt trạng thái `SETTLED`** (đã xác minh receipt trên Fuji hoặc mock evidence). Khi settlement thất bại hoặc bị hủy (`FAILED`), API trả về `result: null`, tuyệt đối không rò rỉ dữ liệu upstream. | `tests/x402-atc26.test.ts` (F4), `tests/p-series.test.ts` (P21) |

---

## Smart Contract Testing & Fuji Deployment Simulation

Foundry tests and deployment scripts are located in `contracts/`:

```bash
# 1. Run all 31 smart contract security tests
cd contracts
forge test

# 2. Run Fuji deployment simulation (Dry-Run, No Broadcast)
forge script script/Deploy.s.sol

# To simulate against Fuji RPC endpoint (requires live connection):
forge script script/Deploy.s.sol --rpc-url https://api.avax-test.network/ext/bc/C/rpc
```

> **Security Guardrail (KEY-02 & CFG-01):** `Deploy.s.sol` and `validateLiveFujiConfig()` strictly reject well-known Anvil/Hardhat private keys and zero addresses, aborting execution if insecure test keys are supplied. Broadcasting to Fuji testnet requires an explicitly funded owner key and explicit owner authorization.

---

## Avalanche Fuji Live Operations Runbook (Stage S1 & S2)

> [!IMPORTANT]
> **Safety Guardrail:** Do NOT execute or broadcast this runbook until dedicated, fresh testnet wallets (Owner, Agent, Seller) are generated and funded via official faucets. Never use Anvil/Hardhat default keys.

This runbook specifies the exact sequence to take MissionPay live on the Avalanche Fuji C-Chain testnet once fresh keypairs are authorized.

### Phase 0: Fuji Environment Setup & Verification
1. **Fund Testnet Accounts**:
   - **Owner EOA**: Needs ~0.5 AVAX for gas + 20 Fuji USDC (`0x5425890298aed601595a70AB815c96711a31Bc65`).
   - **Agent EOA**: No AVAX required (Facilitators pay gas for x402 tool spending).
   - **Seller EOA**: Receives tool micropayment settlements.
2. **Deploy GuardedTreasury Contract**:
   - **Signer**: Owner Account (via Foundry `forge script`)
   - **Command**:
     ```bash
     cd contracts
     forge script script/Deploy.s.sol:Deploy --rpc-url https://api.avax-test.network/ext/bc/C/rpc --broadcast --verify
     ```
   - **Evidence to Record**: Deployed contract address (`GUARDED_TREASURY_ADDRESS`) and Snowtrace contract verification URL.
3. **Configure Production Environment**:
   - Set `GUARDED_TREASURY_ADDRESS` in `.env.local` / production environment.
   - Set `PAYMENT_MODE="LIVE_FUJI"`.
   - Set dedicated `SESSION_WALLET_SEED` and `MISSION_TOKEN_SECRET` (distinct, >= 32 chars).

---

### Phase 1: Stage S1 LIVE Verification (Gasless x402 Micropayments)
1. **Create Mission**: Owner signs `CREATE_MISSION` challenge (10.00 USDC treasuryCap, 5.00 USDC toolCap).
   - **Signer**: Owner (MetaMask / EIP-191 off-chain challenge).
2. **Activate Mission (S1)**: Owner signs `ACTIVATE` challenge; backend issues scoped spend token.
   - **Signer**: Owner (MetaMask / EIP-191).
3. **Execute 2 Live Tool Settlements via x402 Rails**:
   - Agent requests research search (`tool:search` @ 0.10 USDC) & summarization (`tool:summary` @ 0.20 USDC).
   - Agent signs EIP-3009 `TransferWithAuthorization` authorizations off-chain.
   - Facilitator (Ultravioleta or PayAI) relays the transaction on Avalanche Fuji, paying gas.
   - **Signer**: Agent (signs EIP-3009 authorization off-chain); Facilitator (submits & pays gas on Fuji).
   - **Evidence to Record**: 2x x402 Settlement Transaction Hashes (`txHash`) on Snowtrace.
4. **Complete Mission**: Computes deliverable hash and closes S1 lifecycle.
   - **Signer**: Owner (MetaMask / EIP-191).

---

### Phase 2: Stage S2 Cutover & On-Chain Guarded Lifecycle
1. **Cutover to S2**: Update system state stage to `S2` in database.
   - **Signer**: Owner (MetaMask challenge `PAUSE_S1` / cutover).
2. **Fund Session Wallet on-chain**:
   - Owner receives unsigned calldata for `fundMissionWallet(missionId, sessionWallet, toolCap)` from `POST /api/missions/[slug]/activate`.
   - Owner signs and broadcasts transaction on Fuji using MetaMask.
   - Client sends `txHash` to backend; backend verifies `MissionFunded` event on Fuji and commits `SESSION_WALLET_FUNDED` audit entry.
   - **Signer**: Owner (MetaMask, pays transaction gas on Fuji).
   - **Evidence to Record**: `fundMissionWallet` Transaction Hash on Snowtrace.
3. **Owner Sets Payee Merkle Root on-chain (PV-3 & PV-5)**:
   - Owner signs list of authorized mission payees; backend computes standard OpenZeppelin Merkle tree and returns unsigned calldata for `setMissionPayeeRoot(missionId, root)`.
   - Owner signs and broadcasts transaction on Fuji using MetaMask.
   - Client sends `txHash` to backend; backend verifies `MissionPayeeRootSet` event on Fuji via `verifyPayeeRootReceiptOnFuji` and commits `PAYEE_ROOT_SET` audit entry (`policyVersion` advances).
   - **Signer**: Owner (MetaMask, pays gas on Fuji).
   - **Evidence to Record**: `setMissionPayeeRoot` Transaction Hash on Snowtrace.
4. **Agent Autonomous Spend within Session Cap**:
   - Agent spends tool budget via session wallet (gasless x402 EIP-3009).
   - Contract tool cap strictly bounds maximum loss on-chain.
   - **Signer**: Agent / Session Wallet (signs EIP-3009 off-chain); Facilitator (broadcasts).
5. **Treasury Payout with Cryptographic Merkle Proof (`proposeWithProof`)**:
   - Payout to recipient in owner-signed set: Agent calls `proposeWithProof(opId, to, amount, missionId, reason, proof)` with server-computed proof.
     - Within per-tx cap (≤ 5 USDC): Auto-executes disbursement on Fuji.
     - Exceeding per-tx cap (> 5 USDC): Queued -> Owner signs `approve()` and `execute()` via MetaMask.
   - **Signer**: Agent (submits `proposeWithProof`); Owner (MetaMask approval if queued).
   - **Evidence to Record**: `proposeWithProof` / `execute` Transaction Hash on Snowtrace.
6. **Compromised Server Simulation (Tainted Payee Revert Proof)**:
   - Simulates worst-case scenario where agent key is stolen or server compromised, attempting to divert treasury funds to an unlisted attacker address.
   - Run simulation script:
     ```bash
     npx tsx scripts/fuji-tainted-payee-revert.ts # Safe dry-run simulation via eth_call
     # When owner authorizes live broadcast:
     ALLOW_FUJI_BROADCAST=1 npx tsx scripts/fuji-tainted-payee-revert.ts --broadcast
     ```
   - Transaction strictly **reverts on Avalanche Fuji** with error `PayeeNotInMissionSet`.
   - **Evidence to Record**: Reverted Transaction Hash on Snowtrace proving smart contract independent enforcement.
7. **Complete Mission & Anchor Proof On-Chain**:
   - Owner receives unsigned calldata for `anchorMissionProof(missionId, auditHeadHash)` from `POST /api/missions/[slug]/complete`.
   - Owner signs and broadcasts transaction on Fuji using MetaMask.
   - Backend verifies `MissionProofAnchored` event on Fuji and commits `PROOF_ANCHORED` audit entry.
   - **Signer**: Owner (MetaMask, pays gas).
   - **Evidence to Record**: `anchorMissionProof` Transaction Hash on Snowtrace.
8. **Reputation Feedback on Official Fuji ERC-8004 Registry**:
   - Owner calls `POST /api/feedback`; backend returns unsigned calldata for `giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, uri, hash)`.
   - Owner signs and broadcasts transaction to Reputation Registry (`0x8004B663056A597Dffe9eCcC1965A193B7388713`).
   - Backend verifies receipt via `verifyFeedbackReceiptOnFuji` and commits `ERC8004_FEEDBACK` audit entry.
   - **Signer**: Owner (MetaMask, pays gas).
   - **Evidence to Record**: `giveFeedback` Transaction Hash on Snowtrace.

---

## Architectural Invariants

1. **Dual Budget Separation**:
   - Treasury budget (10.00 USDC) is managed for mission deliverables and payouts.
   - Tool wallet budget (5.00 USDC) is allocated off-chain for agent tool operations.
2. **Containment & Recovery**:
   - Mission expiration strictly halts new spending intents.
   - Paused system prevents new authorizations without recalling already signed authorizations.
   - Owners can always read, reconcile, and extract completed deliverables after expiration.
3. **Audit Integrity**:
   - Keccak256 hash chain and checkpoints prove log sequence integrity and non-tampering.
   - Proof bundles provide auditable evidence without exposing private mission deliverables.

---

## Specification Pipeline

| Spec | Title & Link | Scope |
|---|---|---|
| **00** | [Overview & Constants](pipeline/00-overview.md) | Use case, stages, dual budget caps, system invariants. |
| **01** | [Contracts Architecture](pipeline/01-contracts.md) | Treasury mission queue, hard vs soft caps, idempotent propose. |
| **02** | [x402 Tool Economy](pipeline/02-x402-tools.md) | Quote, reservation, authorization, receipt, recovery, TalkMeter. |
| **03** | [ERC-8004 Identity](pipeline/03-erc8004.md) | Identity roles, owner feedback, reputation scoring. |
| **04** | [Agent Validator & Proofs](pipeline/04-agent.md) | Validator, canonical audit, result/proof export. |
| **05** | [Application & Database](pipeline/05-app.md) | PostgreSQL schema/constraints, owner auth, API cutover. |
| **06** | [Tests & Security](pipeline/06-tests-security.md) | C/P/V/E/L acceptance matrix and threat model. |
| **07** | [Demo & Submission](pipeline/07-demo-submission.md) | Submission deck outline, demo video rubric. |
| **08** | [Build Plan & Gates](pipeline/08-build-plan.md) | Execution order, stage release gates, freeze strategy. |
