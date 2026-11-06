# UniHack — Guarded Agent Economy

**Stage S1: Gasless Micro-Payments & Cryptographic Audit for AI Agents on Avalanche**

- **Verification Status**: S1 Payment & Audit Slice Verified in MOCK mode on PostgreSQL 16.
- **Test Suite**: 71/71 Vitest tests pass (37 tests on real PostgreSQL 16 daemon + 34 unit/handler/PGlite isolation tests).
- **Browser E2E**: 1/1 Unmocked Real-Integration spec pass on Chromium (UI -> HTTP -> Prisma -> PostgreSQL 16).
- **Proof Verifier**: Standalone cryptographic verifier pass (`scripts/verify-proof.ts`, keccak256 hash-chaining + Merkle checkpoint match).
- **Open Code Findings**: 0 (CLEANUP-01, TEST-01, M5, M6, R8 closed).

---

## Quick Runbook: Reproducing the Local MOCK Vertical Flow

This guide reproduces the complete S1 vertical lifecycle against an isolated PostgreSQL 16 database and Next.js web application without relying on external testnet faucet AVAX or live gas.

### 1. Prerequisites & Environment Setup

- Node.js >= 20.x, npm >= 10.x, Python >= 3.10
- Dedicated PostgreSQL 16 database running locally on port `55432`

Configure your environment variables (do not commit secrets):

```bash
# Core Database Connections (disposable test database)
DATABASE_URL="postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test"
DIRECT_URL="postgresql://postgres:postgres_test_password@127.0.0.1:55432/unihack_test"

# Runtime & Security Configuration
APP_ORIGIN="http://localhost:3100"
DEPLOYMENT_ID="unihack-test-deployment"
MISSION_TOKEN_SECRET="test-mission-token-secret-must-be-at-least-32-chars-long!"
PAYMENT_MODE="MOCK"

> [!WARNING]
> **Security Warning (KEY-01 - Testnet Safety)**:
> The addresses and private keys listed below (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, `0xac09...`, `0x59c6...`) are well-known default fixture keys from Anvil/Hardhat. They are strictly for **local unit tests and mocked browser test harnesses**.
> **NEVER fund or use these keys on Avalanche Fuji testnet or any public blockchain**, as automated front-running bots monitor and instantly drain all funds sent to known Anvil accounts.
> For Avalanche Fuji live operations (Bước 2 / Stage S2), the project owner must generate fresh, dedicated testnet keypairs in `.env` and fund them via official testnet faucets.

# Standard Test Fixture Addresses (Hardhat / Anvil default accounts - LOCAL ONLY)
OWNER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
SELLER_ADDRESS="0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
AGENT_PRIVATE_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
```

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
| **Database Persistence (PostgreSQL 16)** | **VERIFIED** | 37 P/V/E test cases run directly against live PostgreSQL daemon on port 55432. |
| **Unmocked Browser E2E** | **VERIFIED** | Playwright real-integration spec passes in 36s (retries: 0) against live backend & DB. |
| **Cryptographic Proof Verifier** | **VERIFIED** | Standalone CLI verifier validates hash-chain and Merkle checkpoint. |
| **Avalanche Fuji Live Settlement** | *PENDING* | Requires live testnet RPC, Fuji USDC token balance, and external facilitator relay. |
| **GuardedTreasury Smart Contract (S2)** | **COMPILED & VERIFIED** | Smart contract located in `contracts/`, 30/30 Foundry tests pass (`contracts/test/GuardedTreasury.t.sol`). |
| **ERC-8004 Identity & Feedback (S3)** | **IMPLEMENTED** | Fuji Registry client (`apps/web/lib/erc8004.ts`), 3/3 tests pass (`apps/web/tests/erc8004.test.ts`). |
| **Public Production Deployment** | *PENDING* | Production domain cutover scheduled after local submission artifacts. |

---

## Maximum Potential Loss Bounding (P1-A Security Model)

| Failure / Attack Scenario | Stage S1 Containment | Stage S2 On-Chain Containment (`GuardedTreasury` + Session Wallet) | Maximum Potential Loss |
|---|---|---|---|
| **Agent / Session Key Compromised** | Software validator & DB balance tracking | Contract-funded Session Wallet (`fundMissionWallet`) | **Strictly bounded to mission `toolCap`** (e.g. 5.00 USDC). Treasury balance is untouched. |
| **Prompt Injection proposing payout** | Strictly blocked by `STAGE_S1_NO_TREASURY` | Contract checks full recipient allowlist & caps; reverts on Avalanche Fuji | **0 USDC** (unallowlisted recipient payout impossible). |
| **Server / Database Compromised** | Off-chain checks vulnerable | `GuardedTreasury` contract independently enforces per-tx, daily, and mission caps on-chain | **Bounded by contract daily/mission cap**. Owner emergency pause halts contract. |

---

## Smart Contract Testing & Fuji Deployment Simulation

Foundry tests and deployment scripts are located in `contracts/`:

```bash
# 1. Run all 30 smart contract security tests
cd contracts
forge test

# 2. Run Fuji deployment simulation (Dry-Run, No Broadcast)
forge script script/Deploy.s.sol

# To simulate against Fuji RPC endpoint (requires live connection):
forge script script/Deploy.s.sol --rpc-url https://api.avax-test.network/ext/bc/C/rpc
```

> **Security Guardrail (KEY-02):** `Deploy.s.sol` strictly rejects well-known Anvil/Hardhat private keys and aborts execution if an insecure test key is supplied. Broadcasting to Fuji testnet requires an explicitly funded owner key and explicit owner authorization.

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
