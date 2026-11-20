<div align="center">

# MissionPay

### LLMs can be fooled. Budgets on Avalanche can't.

The owner signs who a mission may pay. The AI agent can only propose.<br>
`GuardedTreasury` on Avalanche rejects every payout outside the signed set, even to a vendor already on the company allowlist.

[![CI](https://github.com/lenamkhanhh/UniHack/actions/workflows/ci.yml/badge.svg)](https://github.com/lenamkhanhh/UniHack/actions/workflows/ci.yml)
![Avalanche Fuji](https://img.shields.io/badge/Avalanche-Fuji%20C--Chain-E84142?logo=avalanche&logoColor=white)
![ICM](https://img.shields.io/badge/ICM-Dispatch%20%E2%86%92%20Fuji%20live-7A3E9D)
![ERC-8004](https://img.shields.io/badge/ERC--8004-validation%20100%2F100-0B7A4B)
![Track](https://img.shields.io/badge/UniHack%202026-Agent%20Economy%20%C2%B7%20x402-121417)

<a href="https://unihack-missionpay.vercel.app"><img src="https://img.shields.io/badge/Live%20demo-E84142?style=for-the-badge&logo=vercel&logoColor=white" alt="Live demo"></a>
<a href="https://drive.google.com/file/d/1OqQu5Q_XHDf-owe6r5xeLyeEydrrYO7Z/view"><img src="https://img.shields.io/badge/Demo%20video%20(2%3A28)-7C3AED?style=for-the-badge&logo=googledrive&logoColor=white" alt="Demo video"></a>
<a href="https://docs.google.com/presentation/d/1MSbomuT7qXj2MCg6taqkS6tEqdVH_VybzS5wTcQAKHY"><img src="https://img.shields.io/badge/Pitch%20deck-F4B400?style=for-the-badge&logo=googleslides&logoColor=white" alt="Pitch deck"></a>
<a href="https://unihack-missionpay.vercel.app/judge"><img src="https://img.shields.io/badge/Judge%20mode-2B59C3?style=for-the-badge&logo=ethereum&logoColor=white" alt="Judge mode"></a>
<a href="https://unihack-missionpay.vercel.app/verify/fuji-live-mission-s1c"><img src="https://img.shields.io/badge/Verify%20audit%20chain-0B7A4B?style=for-the-badge&logo=checkmarx&logoColor=white" alt="Verify"></a>

Team **BaKhiDeVuong** · Avalanche Team1 Vietnam UniHack 2026

</div>

---

## Table of contents

- [Overview](#overview)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Evidence on Avalanche](#evidence-on-avalanche)
- [Evidence by rubric](#evidence-by-rubric)
- [Known limitations](#known-limitations)
- [Getting started](#getting-started)
- [Repository structure](#repository-structure)
- [Documentation](#documentation)

## Overview

AI agents that pay over x402 can be prompt-injected. The attacks that work today do not ask the agent to pay a stranger; they plant a familiar vendor's address in an invoice or a search result. A company allowlist does not stop that, because the vendor is on it.

MissionPay moves the decision out of the model. For each mission the owner signs the exact set of payees (a Merkle root). The agent proposes, a validator checks where the address came from, and the contract on Avalanche pays only an address with a valid proof for that mission. If the LLM is fooled, or our server is taken over, the payout still reverts.

## How it works

1. **The owner signs a mission once.** Goal, caps, expiry and the allowed payees, with a wallet or a passkey checked on-chain by Avalanche's P-256 precompile. The backend never holds the owner's key.
2. **The agent only proposes.** The validator checks the recipient's provenance (owner vs. web page or tool output) and the caps, and writes every step into a Keccak-256 hash chain.
3. **Avalanche decides.** `GuardedTreasury` pays only a payee with a Merkle proof for this mission's root; anything else reverts `PayeeNotInMissionSet`. The audit head is anchored on-chain and an independent ERC-8004 validator scores the mission.

## Architecture

<p align="center"><img src="docs/architecture.png" alt="MissionPay architecture" width="100%"></p>

| Layer | Component | Location | Role |
|---|---|---|---|
| Owner | Mission signing, passkey | `apps/web/app/`, `contracts/src/PasskeyMissionAuthority.sol` | Signs the payee root, caps and expiry; passkey verified by the P-256 precompile |
| Off-chain | AI agent (LLM) | `apps/web/lib/agent.ts`, `apps/web/lib/proposer.ts` | Reads untrusted input, proposes payouts only |
| Off-chain | Validator guard | `packages/guard/`, `apps/web/lib/provenance-trace.ts` | Provenance and cap checks: EXECUTE, QUEUE or BLOCK |
| Off-chain | Audit hash chain | `apps/web/lib/audit.ts`, `apps/web/lib/proof-verifier.ts` | Keccak-256 linked log, recomputed in the browser on `/verify` |
| Off-chain | x402 facilitator | `apps/web/lib/payments.ts` | Gasless USDC tool payments (EIP-3009), bound to the request |
| Fuji C-Chain | `GuardedTreasury` | `contracts/src/GuardedTreasury.sol` | Per-mission Merkle payee set, caps, proof anchoring |
| Fuji C-Chain | ERC-8004 registries | `contracts/src/erc8004/ValidationRegistry.sol`, `apps/web/lib/erc8004.ts` | Agent #294 identity, reputation, independent validation |
| Fuji C-Chain | `MissionBudgetHub` | `contracts/src/MissionBudgetHub.sol` | Receives spend requests over ICM, checks mission, agent and proof |
| Dispatch L1 | `MissionSpendGateway` | `contracts/src/MissionSpendGateway.sol` | Sends the agent's spend request over Teleporter |
| Anyone | Judge Mode, verifier | `apps/web/app/judge/`, `apps/web/app/verify/` | Re-checks any payee with `eth_call`, recomputes the hash chain |

**Loss containment.** A fooled LLM is stopped by the validator; a compromised server is stopped by the contract, because nobody can forge a Merkle proof against the owner-signed root. A leaked agent key only reaches its session wallet, funded up to the mission's tool cap.

## Evidence on Avalanche

| What | Result | Transaction |
|---|---|---|
| Twin Treasury, allowlist mode (13/11) | Allowlisted vendor paid 0.01 USDC | [0x548d…7fc6](https://testnet.snowtrace.io/tx/0x548d1106a69626eed32d308088f188c6d2d71d8e2f61e495f637d9f04e367fc6) |
| Twin Treasury, mission mode | Same vendor reverted `PayeeNotInMissionSet`, 0 USDC | [0x0ad5…3e38](https://testnet.snowtrace.io/tx/0x0ad53adcf5790523e22219dcadc2c69b1a783d22c0bf651a9fa4742b43783e38) |
| Twin Treasury, control | Approved payee still paid | [0xcb72…6315](https://testnet.snowtrace.io/tx/0xcb7236d146a2c8e2789db8ec2a80358b17d65993fc7b07187802e34c48656315) |
| ICM Dispatch → Fuji (20/11) | Agent spend executed by the Fuji hub, 0.10 USDC | [0x5641…443b](https://testnet.snowtrace.io/tx/0x5641b631aba7a1dd2edd8516ded5b0ffa6c09b97029f6cf36800860f8ed1443b) |
| ICM stranger | Rejected `UnauthorizedAgent`, 0 USDC | [0xdd99…341d](https://testnet.snowtrace.io/tx/0xdd99bfd754ea2f200581c3ab08d8245799c203f114d820677a85356b3f40341d) |
| ERC-8004 validation | Independent validator scored mission s1c 100/100 | [0xa9f7…5ffa](https://testnet.snowtrace.io/tx/0xa9f7faddb9e15f0efdb94349f49aed63a5af30666a9edeeffbb5fe8814af5ffa) |
| Audit anchor | Head hash anchored in `GuardedTreasury` | [0x43bd…0547](https://testnet.snowtrace.io/tx/0x43bd21b81248a9f1a4dc2ff037a3df8119ae098690cd4e353bdbb4ce6ceb0547) |

Contracts: GuardedTreasury [`0x20451c1e…d545`](https://testnet.snowtrace.io/address/0x20451c1e2dCD83F166B4f22868BAdECb5868d545) · MissionBudgetHub [`0x8Ba595B3…6fE3`](https://testnet.snowtrace.io/address/0x8Ba595B37b2206Df29D05Cf8fE42477eEB426fE3) · every link in [`FUJI_EVIDENCE.md`](artifacts/submission-s1/FUJI_EVIDENCE.md).

## Evidence by rubric

| Criterion | What is built | Verify |
|---|---|---|
| **Tech (25)** | Merkle payee sets with root snapshotting and invariant fuzzing; x402 / EIP-3009 rails; WebAuthn P-256 authority; provenance guard SDK | `forge test --summary` (111 passed, 32,768 fuzz calls) · `npx vitest run --root apps/web` (355 tests) · `npx vitest run --root packages/guard` (19 passed) |
| **Avalanche (25)** | C-Chain settlement, ERC-8004 identity/reputation/validation, ICM live between Dispatch L1 and Fuji, P-256 precompile | `forge test --match-contract MissionCrossChainICMTest` (12 passed) · `evidence/m9/icm-live.json` |
| **Creativity (15)** | A payee set per mission instead of one company allowlist; a public bounty arena where the LLM can be fooled but the contract still says no | `/bounty`, `/arena/twin` |
| **Impact (15)** | AgentDojo banking, live Gemini 3.1 Flash-Lite: 31/48 attacks succeed without a guard, **2/48 with MissionPay**. Replay 120/128 blocked; Fuji fork 150/150 reverted with the attacker on the allowlist. PayBench-ADI 0/277 attacks moved money, 40/40 legitimate tasks passed | `eval/agentdojo/LIVE_SUMMARY.md`, `eval/README.md` |
| **Pitch (10)** | 15-slide deck and a narrated 2:28 video | [Slides](https://docs.google.com/presentation/d/1MSbomuT7qXj2MCg6taqkS6tEqdVH_VybzS5wTcQAKHY) · [PDF](artifacts/submission-s1/MissionPay-pitch-deck-v2.pdf) · [Video](https://drive.google.com/file/d/1OqQu5Q_XHDf-owe6r5xeLyeEydrrYO7Z/view) |
| **UI/UX (10)** | Bilingual (EN/VI) app, colour by meaning, Judge Mode on the live contract, in-browser audit verification; Playwright E2E (42 tests) green in CI | `npx playwright test` |

## Known limitations

1. **ICM delivery.** Both Fuji deliveries were made by a public ICM relayer. Our self-relay (`scripts/m9-self-relay.ts`, Glacier BLS aggregation) produced a valid signed message but arrived a block later.
2. **AgentDojo misses (`user_task_15`).** In every miss the user's own prompt sets the attacker's IBAN as the new landlord. The owner's mission signature is the human check; an agent cannot tell user intent from user error.
3. **Owner can reset a root to 0.** That falls back to the global allowlist, publicly: `MissionPayeeRootSet` is emitted and `policyVersion` increments.
4. **Deployed bytecode on Fuji is the earlier version.** Root snapshotting (A1) and passkey governance (A3) are in `contracts/src/` and tested, not redeployed, so the Twin Treasury evidence stays tied to one address.
5. **Hardware biometrics.** Verified with P-256 vectors and WebAuthn virtual authenticators; a physical biometric prompt on live Fuji is `NOT_RUN`.

## Getting started

Prerequisites: Node.js 20+, npm 10+, Foundry (`forge`), Python 3.10+, PostgreSQL for the web tests.

```bash
npm install
npm run verify:all          # forge tests, guard SDK, web tests, tsc, AgentDojo unit tests
cd apps/web && npx prisma migrate deploy && cd ../..
npm run dev -- -p 3100      # http://localhost:3100
```

Routes: `/judge` (live contract checks) · `/arena/twin` (Twin Treasury receipts) · `/bounty` (public challenge) · `/verify/fuji-live-mission-s1c` (audit chain).

## Repository structure

```
apps/web/            Next.js app: agent, validator, x402 rails, Judge Mode, verifier, bounty arena
contracts/           Foundry: GuardedTreasury, passkey authority, ICM hub/gateway, ValidationRegistry
packages/guard/      Provenance guard SDK (used by the app and by the AgentDojo defense)
packages/mcp/        MCP server exposing MissionPay to agent frameworks
eval/                AgentDojo live + replay, PayBench-ADI cases and results
evidence/            On-chain receipts and exports (Fuji missions, Twin Treasury, ICM live)
scripts/             Fuji runners, ICM self-relay, validator, video build
artifacts/           Submission deck, video, screenshots
docs/                Architecture, security notes, deploy runbook, pitch material, research
```

## Documentation

| Topic | Files |
|---|---|
| Architecture | [`docs/architecture.svg`](docs/architecture.svg) |
| Security and formal checks | [`FORMAL.md`](docs/security/FORMAL.md) · [`ATTACK_EVAL.md`](docs/security/ATTACK_EVAL.md) · [`ADAPTIVE_ATTACK.md`](docs/security/ADAPTIVE_ATTACK.md) · [`SECURITY.md`](SECURITY.md) |
| Avalanche specifics | [`PASSKEY.md`](docs/avalanche/PASSKEY.md) · [`m9-self-relay-spike.md`](docs/avalanche/m9-self-relay-spike.md) · [`FUJI_EVIDENCE.md`](artifacts/submission-s1/FUJI_EVIDENCE.md) |
| Pitch and judge Q&A | [`JUDGE_QA.md`](docs/pitch/JUDGE_QA.md) · [`VIDEO_SCRIPT.md`](docs/pitch/VIDEO_SCRIPT.md) |
| Deploy | [`DEPLOY_RUNBOOK.md`](docs/deploy/DEPLOY_RUNBOOK.md) · [`DEPLOY_CHECKLIST.md`](docs/deploy/DEPLOY_CHECKLIST.md) |
| Research and design history | [`docs/research/`](docs/research/) · [`docs/design/pipeline/`](docs/design/pipeline/) · [`docs/review-history/`](docs/review-history/) |
