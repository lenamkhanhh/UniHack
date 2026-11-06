# MissionPay — Pitch Deck Outline (11 Slides)
**Positioning**: "Giao cho AI agent một nhiệm vụ và một ngân sách. Avalanche bảo đảm nó không tiêu quá, và bạn thấy từng đồng đi đâu."  
*(Give your AI agent a mission and a budget. Avalanche makes sure it can't overspend — and shows you every cent.)*

---

## Slide 1: Title & Core Positioning
- **Brand Name**: MissionPay (formerly Guarded Agent Economy)
- **Tagline**: The On-Chain Guardrail & Verifiable Payment Rail for Autonomous AI Agents on Avalanche.
- **Value Proposition**: Giao cho AI agent một nhiệm vụ và một ngân sách. Smart contract trên Avalanche bảo đảm agent không thể chi tiêu vượt hạn mức — và bạn có bằng chứng mật mã xác minh từng đồng đi đâu.
- **Track**: AI Agents & Avalanche C-Chain / L1 Integration (UniHack 2026).
- **Architecture**: EIP-3009 Gasless USDC Micropayments (x402 v1) + GuardedTreasury Smart Contract + ERC-8004 Multi-Agent Reputation.

---

## Slide 2: The Problem — Giving a Wallet to an AI Agent is Giving a Blank Check
- **The Explosion of the Agent Economy**:
  - Over 27,499 paid x402 machine-to-machine endpoints active in 2026.
  - Autonomous agents need to pay for tools, inference, web search, and data feeds in real time.
- **The Hidden Threat Vector**:
  - **1,495 endpoints** charge higher than advertised quote prices (silent price-mismatch overcharging).
  - **Prompt Injection & Model Hallucination**: An untrusted tool response or prompt injection can instruct an agent to drain its hot wallet or transfer treasury funds to an attacker.
  - **Client-Side Enforcers Fall Short**: Existing guards (Countersign, x402 client libraries) enforce spend caps *off-chain in software*. If the agent's key leaks or server memory is dumped, the entire wallet balance is drained.
- **Gas Exhaustion**: Requiring every sub-agent to hold native AVAX for gas introduces complex balance management and failure modes.

---

## Slide 3: Target Persona & User Story
- **Target Persona**: AI Research Labs, Web3 Autonomous DAOs, and Fintech Developers deploying autonomous agent workflows.
- **The Scenario**:
  - Dr. Alex (AI Lab Lead) needs an autonomous agent to research market intelligence, query paid data APIs (Avalanche stats, academic summaries), and pay tool providers automatically.
  - **Risk**: Alex cannot grant the agent access to a company credit card or an unconstrained treasury wallet.
- **The MissionPay Solution**:
  - Alex creates a **Mission**: specifies the goal, a **10.00 USDC Treasury Cap**, and a **5.00 USDC Tool Cap**, signing once with MetaMask.
  - The agent receives an isolated, gasless **Session Wallet** locked on Avalanche to exactly 5.00 USDC.
  - Even if the agent is hijacked by an adversarial injection, the loss is mathematically bounded on-chain to $5.00, and Alex receives a tamper-evident audit receipt.

---

## Slide 4: Product Architecture — Mission -> Budget -> Proof
```
[Owner (MetaMask)] ──(Signs Challenge)──> [Mission Contract: GuardedTreasury.sol]
                                                 │
                                                 ├── Locks Treasury Cap (10 USDC)
                                                 └── Funds Session Wallet (5 USDC Tool Cap)
                                                           │
[Adversarial Web / Tools] ◄──(x402 Gasless USDC)───────────┤
         │                                                 │
  (Prompt Injection)                                       ▼
         │                                    [Keccak256 Hash Chain]
         ▼                                                 │
[Agent Validator Engine] ──(BLOCK/QUEUE)──> [Anchor Head Hash on Fuji: MissionProofAnchored]
                                                           │
                                                           ▼
                                         [ERC-8004 Reputation Registry Feedback]
```
- **Dual Budget Separation**: Tool budget (micropayments via EIP-3009) vs. Treasury budget (settlement milestones).
- **Session Wallets**: Derived via HKDF-SHA256 with isolated seed per mission, funded on-chain.
- **Verifiable Proof**: Hash-chained audit ledger, anchored permanently into Avalanche Fuji smart contracts.

---

## Slide 5: Vertical Workflow Walkthrough
1. **Mission Initialization**: Owner defines scope, sets hard caps, and signs EIP-191 activation challenge.
2. **On-Chain Budget Funding**: `GuardedTreasury.fundMissionWallet` transfers tool budget directly to the mission's session wallet on Avalanche Fuji.
3. **Autonomous Execution**:
   - Agent performs live web research (`tool:search`).
   - Agent calls continuous resource metering (`tool:talkmeter` @ $0.05/min with strict anti-premature-tick validation).
   - Agent requests deep summarization (`tool:summary`).
4. **Idempotent x402 Settlement**: EIP-3009 signed authorizations settled gaslessly via Ultravioleta / PayAI facilitators.
5. **Mission Completion & Anchoring**: Agent computes deliverable hash; backend anchors `auditHeadHash` to `GuardedTreasury.sol` via `anchorMissionProof`.
6. **Reputation Feedback**: Mission owner calls official Fuji ERC-8004 `ReputationRegistry.giveFeedback` (8-argument ABI).

---

## Slide 6: 3-Layer Security & Maximum Potential Loss Bounding

| Failure / Attack Vector | Layer 1: Code Validator | Layer 2: Session Wallet (P1-A) | Layer 3: Smart Contract (Avalanche) | Maximum Potential Loss |
|---|---|---|---|---|
| **Agent / Session Key Stolen** | Bypassed (attacker has key) | **Isolated EOA per mission**; holds only remaining tool budget | Contract rejects funds beyond `toolCap` | **Bounded strictly to mission toolCap (e.g. 5.00 USDC)**. Treasury ($10.00+) is 100% untouched. |
| **Prompt Injection proposing payout** | **BLOCKED** by policy | Cannot sign for Treasury | Contract checks allowlist & per-tx cap; reverts | **0 USDC** (unallowlisted payout structurally impossible). |
| **Server / DB Compromised** | Bypassed (server owned) | Session keys rotated/isolated | `GuardedTreasury` independently enforces hard daily & mission caps on Fuji | **Bounded by on-chain soft/hard caps**; Owner emergency pause halts contract. |
| **Tool Price-Mismatch (> advertised)** | **BLOCKED** by quote comparison | Payment not signed | Operation aborted; zero gas/funds lost | **0 USDC**. |

*Note: Session key generation uses cryptographically secure HKDF-SHA256 with dedicated 32-byte seeds (`SESSION_WALLET_SEED`), completely segregated from JWT secrets. Zero fallback keys.*

---

## Slide 7: Deep Avalanche Integration
- **1. Native USDC Gasless Micropayments (x402 Protocol)**:
  - Avalanche Fuji USDC (`0x5425890298aed601595a70AB815c96711a31Bc65`, 6 decimals).
  - Uses native EIP-3009 `receiveWithAuthorization` & `transferWithAuthorization`.
  - Facilitators (Ultravioleta / PayAI) pay gas, eliminating AVAX onboarding friction for AI agents.
- **2. GuardedTreasury.sol (Fuji Contract)**:
  - Deployed & verified on Avalanche Fuji C-Chain.
  - Multi-tier caps: Per-transaction cap, UTC-reset daily cap, mission lifetime cap.
  - Gasless sweep via EIP-3009 authorization (contract owner pays gas to reclaim unspent funds).
  - Proof anchoring: Emits `MissionProofAnchored(bytes32 missionId, bytes32 headHash)`.
- **3. Official ERC-8004 Integration (Avalanche Official Registry)**:
  - Identity Registry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`): Agent ERC-721 token IDs.
  - Reputation Registry (`0x8004B663056A597Dffe9eCcC1965A193B7388713`): 8-argument verified `giveFeedback` interface called by mission owner.

---

## Slide 8: Competitive Landscape & Unfair Advantages

| Capability | Countersign Network | Cloudflare Wallets | x402 Agent Guard | **MissionPay (Ours)** |
|---|---|---|---|---|
| **Enforcement Layer** | Off-Chain (SDK / MCP) | Custodial Cloud Platform | Client Software | **On-Chain Smart Contract (Avalanche)** |
| **Blast Radius on Key Leak** | Total Wallet Balance | Custodial Account Balance | Client Wallet Balance | **Strictly Bounded to Mission Tool Cap** |
| **Budget Model** | Global Account Allowance | Global Card Limit | Per-Process Limit | **Task-Scoped, Owner-Signed with Expiry** |
| **Audit Verification** | Internal JSON Log | Cloudflare Dashboard | None | **Hash-Chained & Anchored to Avalanche C-Chain** |
| **Multi-Agent Reputation** | None | None | None | **Official Fuji ERC-8004 Registry** |
| **Gasless Micropayments** | Partial | No (fiat/custodial) | Yes (x402) | **Yes (EIP-3009 USDC on Avalanche Fuji)** |

---

## Slide 9: Live Testnet Evidence & Verification
- **Testnet Network**: Avalanche Fuji Testnet (Chain ID: 43113)
- **Verified Smart Contract**:
  - `GuardedTreasury.sol`: `PENDING_FUJI` (Foundry dry-run verified, 31/31 unit tests pass)
  - Snowtrace Verification: `PENDING_FUJI`
- **Official ERC-8004 Fuji Registries**:
  - Identity Registry: [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.snowtrace.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e)
  - Reputation Registry: [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://testnet.snowtrace.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)
- **Live Transactions (Fuji)**:
  - Mission Tool Budget Funding (`fundMissionWallet`): `PENDING_FUJI`
  - x402 Tool Settlement Tx (Ultravioleta Facilitator): `PENDING_FUJI`
  - On-Chain Audit Proof Anchoring (`anchorMissionProof`): `PENDING_FUJI`
  - ERC-8004 Reputation Feedback Tx (`giveFeedback`): `PENDING_FUJI`
- **Offline / Local Verification**:
  - Independent CLI Hash-Chain Verifier: `scripts/verify-proof.ts`
  - Vitest Test Suite: **101/101 passing across 8 suites**
  - Foundry Test Suite: **31/31 passing**

---

## Slide 10: Business Model & Future Roadmap
- **Monetization Strategy**:
  - **Protocol Fee**: 0.25% fee on settled x402 agent tool micropayments.
  - **Enterprise SaaS Tier**: Dedicated policy orchestrators, SOC2 compliant audit export, and custom LLM security adapters for AI Labs and DAOs.
- **Roadmap**:
  - **Q1 2027**: Mainnet deployment on Avalanche C-Chain with Circle native USDC.
  - **Q2 2027**: Custom Avalanche L1 Subnet tailored for high-throughput agent identity, reputation state, and micro-settlement streaming.
  - **Q3 2027**: Standardized MCP (Model Context Protocol) Server for plug-and-play integration with Claude Desktop, Cursor, and LangChain.

---

## Slide 11: Team & Project Links
- **Team**: UniHack Team 1 Builders (Full-Stack Blockchain & AI Engineering)
- **Live Demo Application**: `PENDING_FUJI` (Local Dev: `http://localhost:3100/demo`)
- **Open-Source Repository**: `https://github.com/team1vn/unihack-missionpay` (Branch: `feat/s1-app`)
- **Documentation & Verification CLI**: Complete runbook, max-loss proofs, and Foundry test harness included in repository root.
