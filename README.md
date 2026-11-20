# MissionPay

> **AI agents get fooled. Budgets on Avalanche don't.** The owner signs who a mission may pay; the agent can only propose; GuardedTreasury on Avalanche rejects every payout outside the signed set, even to a vendor already on the company allowlist.

[![CI](https://github.com/lenamkhanhh/UniHack/actions/workflows/ci.yml/badge.svg)](https://github.com/lenamkhanhh/UniHack/actions/workflows/ci.yml)

- **Live Demo:** [https://unihack-missionpay.vercel.app](https://unihack-missionpay.vercel.app)
- **Video Presentation (2:28, narrated):** [`artifacts/submission-s1/video/MissionPay-demo.mp4`](artifacts/submission-s1/video/MissionPay-demo.mp4)
- **Judge mode (verify in 30 s):** `/judge` asks the live Fuji contract about any address you type (read-only `eth_call`, no key, no gas).
- **Twin Treasury, live on Fuji (13/11/2026):** same allowlisted vendor, same treasury. Allowlist-only mission paid it ([0x548d…7fc6](https://testnet.snowtrace.io/tx/0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6)); payee-set mission reverted `PayeeNotInMissionSet` ([0x0ad5…3e38](https://testnet.snowtrace.io/tx/0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38)); approved payee still paid ([0xcb72…6315](https://testnet.snowtrace.io/tx/0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315)).
- **Snowtrace GuardedTreasury Contract:** [`0x20451c1e2dCD83F166B4f22868BAdECb5868d545`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545)

---

## 1. Evidence by Rubric (Judge in 60 Seconds)

| Criterion (Points) | Implementation & Artifacts | Primary Files | Exact Test / Verification Command | On-Chain Address / Tx Hash |
|---|---|---|---|---|
| **Tech (25)** | Full-stack agent budgeting architecture: GuardedTreasury with Merkle payee snapshotting & invariant fuzzing, gasless micropayment session rails (x402 / EIP-3009), WebAuthn P-256 passkey authority, and provenance SDK. | `contracts/src/GuardedTreasury.sol`<br>`apps/web/lib/`<br>`packages/guard/` | `forge test --summary` (111 passed, 512 invariant runs / 32,768 calls)<br>`npx vitest run --root apps/web` (350 passed)<br>`npx vitest run --root packages/guard` (19 passed) | GuardedTreasury: [`0x20451c1e...`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545)<br>Audit head anchor tx: [`0x43bd21b8...`](https://testnet.snowtrace.io/tx/0x43bd21b81248a9f1a4dc2ff037a3df8119ae098690cd4e353bdbb4ce6ceb0547) |
| **Avalanche (25)** | Avalanche C-Chain settlement: GuardedTreasury on Fuji (`ChainID 43113`), gasless EIP-3009 facilitator rails, ERC-8004 Identity & Reputation registries, and ICM hub and gateway contracts between Fuji and Dispatch L1 (`ChainID 779672`), live on testnet since 20/11 (agent spend sent on Dispatch, executed on Fuji; stranger spend rejected on Fuji; see `evidence/m9/icm-live.json`). | `contracts/src/MissionBudgetHub.sol`<br>`contracts/src/MissionSpendGateway.sol`<br>`contracts/src/ValidationRegistry.sol`<br>`apps/web/lib/erc8004.ts` | `forge test --match-contract MissionCrossChainICMTest` (12 passed)<br>`npx vitest run --root apps/web tests/erc8004.test.ts` (11 passed) | Attack revert tx (`PayeeNotInMissionSet`): [`0xc5f13e5d...`](https://testnet.snowtrace.io/tx/0xc5f13e5d2986633182ba8d69d5560429b063c5bf5f871c6908962933fea4f1ff)<br>ValidationRegistry: [`0x4c5ccda2...`](https://testnet.snowtrace.io/address/0x4c5ccda2a630cd1cb706799deadcc8483d06697e)<br>Agent #294 on Fuji IdentityRegistry: [`0xb5646950...`](https://testnet.snowtrace.io/tx/0xb5646950b8a1541b5b18a3812b8c17b7c3abc88fb91b0857bd142dd9991507c8) |
| **Creativity (15)** | Mission-scoped cryptographic payee Merkle tree where owner signs policy once with passkey (WebAuthn P-256), while EVM bytecode enforces payment caps; Public Bounty arena demonstrating attack attempts where LLM is fooled but on-chain contract rejects off-mission payouts. | `apps/web/app/bounty/`<br>`contracts/src/PasskeyMissionAuthority.sol`<br>`eval/agentdojo/` | `npx vitest run --root apps/web tests/bounty.test.ts` (18 passed)<br>`forge test --match-contract PasskeyGovernanceTest` (32 passed) | Live Bounty contract state on Fuji (`0x20451c1e...`)<br>Revert proof tx: [`0xc5f13e5d...`](https://testnet.snowtrace.io/tx/0xc5f13e5d2986633182ba8d69d5560429b063c5bf5f871c6908962933fea4f1ff) |
| **Impact (15)** | Evaluated defense benchmarks: AgentDojo banking replay blocked 120/128 financial injections (all 8 misses: `user_task_15`); benign false positives 3/16 (same as ProvGuard policy v1); Fuji fork agreement 169/169 (with attacker on allowlist contract reverts 150/150). AgentDojo live (Gemini 3.1 Flash-Lite) is being re-measured: an executor bug (fixed in b8152d6, regression test `eval/agentdojo/test_defense_tool_output.py`) invalidated the earlier live run, so no live number is claimed yet. PayBench-ADI: 0/277 attack runs moved money. | `eval/agentdojo/SUMMARY.md`<br>`eval/agentdojo/LIVE_SUMMARY.md`<br>`eval/README.md` | `python -m unittest eval/agentdojo/test_provguard_pairs.py` (14 passed) | Replay JSON: `eval/agentdojo/results/replay-ground-truth-20261109-035811.json`<br>Live rerun (partial, in progress): `eval/agentdojo/LIVE_SUMMARY.md` |
| **Pitch (10)** | Pitch Deck v2 (14 native 16:9 widescreen slides in PPTX + rendered PDF + slide shots) in the same paper/ink design as the web app; video script with timed cues and English voiceover for demo presentation. | `artifacts/submission-s1/MissionPay-pitch-deck-v2.pdf`<br>`artifacts/submission-s1/deck-shots/`<br>`VIDEO_SCRIPT.md` | `node artifacts/submission-s1/deck-v2/build_deck.js` | Deck PDF: `artifacts/submission-s1/MissionPay-pitch-deck-v2.pdf`<br>Slide 9 benchmark shot: `artifacts/submission-s1/deck-shots/slide-9-benchmark.png` |
| **UI/UX (10)** | Bilingual Next.js app (EN/VI), light paper/ink design with colour by meaning (red = blocked, green = paid), Judge mode that queries the live contract, passkey onboarding, live audit verification. Playwright E2E suite (42 tests) runs in CI, green; Lighthouse accessibility 100 measured 09/11 before the redesign (not re-measured). | `apps/web/app/`<br>`apps/web/lib/i18n.tsx`<br>`apps/web/e2e/passkey.spec.ts` | `npx playwright test e2e/passkey.spec.ts` (7 passed)<br>`npx vitest run --root apps/web tests/m7-validator-automation.test.ts` (41 passed) | Live mission with anchor + ERC-8004 100/100: `/verify/fuji-live-mission-s1c` ([validation tx](https://testnet.snowtrace.io/tx/0xa9f7faddb9e15f0efdb94349f49aed63a5af30666a9edeeffbb5fe8814af5ffa))<br>Live bounty route: `/bounty` |

---

## 2. Known Limitations & Operating Boundaries

1. **Avalanche Inter-Chain Messaging (ICM):** Live on testnet (20/11). `MissionSpendGateway` on Dispatch ([`0x20451c1e...`](https://subnets-test.avax.network/dispatch/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545)) sends the agent's spend request over Teleporter; `MissionBudgetHub` on Fuji ([`0x8Ba595B3...`](https://testnet.snowtrace.io/address/0x8Ba595B37b2206Df29D05Cf8fE42477eEB426fE3)) checks mission, agent and Merkle payee proof before paying USDC. Authorized spend: Dispatch tx `0x6f806bfc...` executed on Fuji ([`0x5641b631...`](https://testnet.snowtrace.io/tx/0x5641b631aba7a1dd2edd8516ded5b0ffa6c09b97029f6cf36800860f8ed1443b), `SpendExecuted`, 0.10 USDC). Stranger spend: Dispatch tx `0xb7f337c3...` rejected on Fuji ([`0xdd99bfd7...`](https://testnet.snowtrace.io/tx/0xdd99bfd754ea2f200581c3ab08d8245799c203f114d820677a85356b3f40341d), `MessageExecutionFailed`, `UnauthorizedAgent`, 0 USDC). Honest note: both Fuji deliveries were made by a public ICM relayer; our own self-relay (`scripts/m9-self-relay.ts`, Glacier BLS aggregation) produced a valid signed message but arrived one block later. Receipts: `evidence/m9/icm-live.json`.
2. **AgentDojo Replay Misses (user_task_15):** In the AgentDojo banking replay benchmark, 8 of 128 attacks bypassed automated checks. In all 8 cases (`user_task_15`), the user prompt itself explicitly directs the agent to set the attacker's IBAN as the new landlord. MissionPay treats the human owner's one-time cryptographic mission authorization as the intentional security boundary; an agent cannot distinguish user intent from user error without human review.
3. **Owner Policy Reset to Root 0:** A contract owner has the administrative authority to reset a mission's payee Merkle root to `bytes32(0)` to fall back to the global allowlist mode. This operation is fully public and transparent on-chain: it emits a `MissionPayeeRootSet` event and increments `policyVersion` on the smart contract.
4. **On-Chain Contract Patches on Fuji:** The contract code in `contracts/src/` has been updated with root snapshotting at proposal time (A1) and passkey governance actions (A3), verified with 111 Foundry tests and 6 stateful invariants. The deployed contract on Avalanche Fuji ([`0x20451c1e...`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545)) is the historical deployment; new bytecode deployment is pending owner broadcast authorization.
5. **Hardware Biometric Devices:** Passkey verification is cryptographically verified in tests using exact P-256 curve algorithms, WebAuthn virtual authenticators, and dynamic RP origin adapters (`LOCAL_BROWSER_CRYPTO_BOUNDARY`). Direct physical biometric hardware prompt verification on live Fuji is marked `NOT_RUN` pending physical device sign-off.

---

## 3. Quickstart & Verification Runbook

### Prerequisites
- Node.js >= 20.x, npm >= 10.x, Foundry (`forge`), Python >= 3.10
- Local PostgreSQL instance (or PGlite in-memory test runner)

### One-Command Full Suite Verification
Run the unified verification command at the repository root:

```bash
npm run verify:all
```

This runs:
1. Smart contract test suites: `forge test --summary` in `contracts/`
2. SDK unit and parity tests: `vitest run` in `packages/guard/`
3. Web application unit tests: `vitest run` in `apps/web/`
4. TypeScript compilation check: `tsc --noEmit` in `apps/web/`
5. AgentDojo benchmark unit tests: `python -m unittest test_provguard_pairs.py` in `eval/agentdojo/`

### Local Development Mode
```bash
# 1. Install dependencies
npm install

# 2. Setup database migrations
cd apps/web && npx prisma migrate deploy && cd ../..

# 3. Start development server
npm run dev -- -p 3100
```

Open `http://localhost:3100` to interact with MissionPay, `/bounty` for the public challenge, and `/verify/demo-seed` for cryptographic audit trail inspection.

---

## 4. Architecture Overview

```
                                  +------------------------------+
                                  | Human Owner / Hardware Key   |
                                  | WebAuthn P-256 (RIP-7212)    |
                                  +--------------+---------------+
                                                 | Authorizes Mission & Policy
                                                 v
  +--------------------+         +---------------+---------------+
  | Off-Chain AI Agent | ------> | Provenance Guard & Validator  |
  | (Prompt Injected)  |         | (Tracks Source & Merkle Set)  |
  +--------------------+         +---------------+---------------+
                                                 | Proposes Payout
                                                 v
                     ===========================================================
                                Avalanche Fuji C-Chain Smart Contracts
                     ===========================================================
                                                 |
                                                 v
                                  +------------------------------+
                                  |     GuardedTreasury.sol      |
                                  | - Merkle Payee Snapshot Check|
                                  | - Per-Mission Budget Caps    |
                                  | - Gasless EIP-3009 Sweep     |
                                  +------------------------------+
                                                 |
                     +---------------------------+---------------------------+
                     |                                                       |
                     v (Legitimate Payee)                                    v (Injected Attacker Payee)
      [SUCCESS: Payout Executed]                                [REVERT: PayeeNotInMissionSet]
```

### Security & Loss Containment Model
- **Prompt Injection Containment:** If an LLM agent is tricked via indirect prompt injection to pay an unauthorized address, the off-chain guard rejects the transaction. Even if the off-chain guard or agent server is entirely compromised, the transaction submitted to `GuardedTreasury` reverts on-chain because the attacker cannot forge a valid Merkle proof against the owner-signed Merkle root.
- **Session Wallet Loss Bounding:** Session wallets derived for automated tool micropayments are funded only up to the mission's `toolCap` (e.g. 0.50 USDC). Unspent balances are reclaimed via gasless EIP-3009 sweeps without requiring AVAX for gas. Main treasury balances cannot be accessed by session keys.

---

## 5. Review History & Prior Art
Historical review logs, development notes, and milestone progression are archived in [`docs/review-history/`](docs/review-history/):
- [`docs/review-history/REPORT_REVIEW_AND_FIX_COMPLETION.md`](docs/review-history/REPORT_REVIEW_AND_FIX_COMPLETION.md) — Comprehensive test and acceptance logs (all review rounds)
- [`JUDGE_QA.md`](JUDGE_QA.md) — Verified metrics and answers to technical evaluation questions
