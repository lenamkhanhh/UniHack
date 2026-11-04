# Build sources — what is actually useful, and what to copy

**Research snapshot:** 4 November 2026 (Asia/Ho_Chi_Minh)
**Decision this pack supports:** Guarded Agent Economy (hybrid) as the main
direction, with x402 Micropayment Rails + TalkMeter as the fallback slice.
The hybrid is: agent proposes only, a guard contract enforces policy
on-chain, out-of-policy proposals go to a human pending queue, tool
purchases settle through x402 on Fuji, and the agent carries an ERC-8004
identity + reputation. See `spike-checklist.md` for the 2-day pass/fail test.

This file is a curated build pack, not a link dump. Every entry says what
to take from it and what not to copy. Nothing here is organizer advice.
Verify every contract address on Snowtrace before sending test funds.

## 0. Fuji config — set this up first, before writing product code

| Item | Fuji (testnet) | C-Chain (mainnet) |
|---|---|---|
| Chain ID | 43113 | 43114 |
| RPC | `https://api.avax-test.network/ext/bc/C/rpc` | `https://api.avax.network/ext/bc/C/rpc` |
| Explorer | `https://testnet.snowtrace.io` | `https://snowtrace.io` |
| USDC | `0x5425890298aed601595a70AB815c96711a31Bc65` (6 decimals) | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` |
| AVAX faucet | `https://faucet.avax.network` | — (buy AVAX) |
| USDC faucet | `https://faucet.circle.com` | — |

Rules that save a day of debugging:

- Get AVAX first, then USDC: faucet transactions need gas.
- USDC has 6 decimals, so $0.50 is `500000` atomic units, not `500000000000000000`.
- Always re-check the USDC address against Circle's official list
  (`https://developers.circle.com/stablecoins/usdc-contract-addresses`)
  before sending anything, even on testnet.
- Testnet only for this hackathon. No real funds, no mainnet private key
  in the repo, ever. `.env` stays gitignored.

## 1. x402 on Avalanche — pick ONE facilitator for the spike, do not build two

### 1a. Ultravioleta DAO — hosted facilitator (try first for speed)

- Facilitator: `https://facilitator.ultravioletadao.xyz`
- Available on both C-Chain and Fuji; the client needs USDC only, the
  facilitator sponsors AVAX gas.
- Flow: client signs an EIP-712 / ERC-3009 `transferWithAuthorization`,
  merchant forwards the proof, facilitator verifies signature, balance
  and nonce, then submits the settlement transaction and pays gas.
- Middleware example in the source uses `x402-hono` with network
  `"avalanche-c-chain"` or `"avalanche-fuji"` and a price per route
  (for example `"$0.01"`).
- **Take:** the fastest path to a working `402 -> sign -> 200` round-trip
  on Fuji, and the cleanest explanation of the wire protocol.
- **Do not assume:** that a hosted facilitator is up during judging.
  Record successful settlement tx hashes early, and have the fallback
  in 1c ready.

Source: [Ultravioleta DAO on Avalanche Builder Hub](https://build.avax.network/integrations/ultravioletadao)

### 1b. Thirdweb x402 — hosted facilitator with a dashboard

- Facilitator is created from a Thirdweb client + your own server wallet
  address; it verifies and submits payments and uses EIP-7702 for
  gasless submission. It works with `x402-hono`, `x402-next` and
  `x402-express`.
- Network strings: `"avalanche"` for mainnet, `"avalanche-fuji"` for
  testnet; chain IDs 43114 / 43113 as above.
- Settlement wait modes include `"simulated"`, `"submitted"` and
  `"confirmed"` (default). For a judging demo, use `"confirmed"`.
- **Take:** the dashboard view of facilitator transactions, useful for
  the audit ledger, and the `supported()` query to check which
  chain/token pairs a facilitator actually supports before demo day.
- **Do not copy blindly:** example code in the source uses placeholder
  wallet addresses (`0x1234…`) and a mainnet network string. Replace
  both, and never commit a real secret key.

Source: [Thirdweb x402 on Avalanche Builder Hub](https://build.avax.network/integrations/thirdweb-x402)

### 1c. x402-rs — self-hosted facilitator (fallback, not the first build)

- Rust implementation: core protocol types, a facilitator binary, an
  Axum middleware (`x402-axum`) and a reqwest client (`x402-reqwest`).
- Docker: `docker run --env-file .env -p 8080:8080 ukstv/x402-facilitator`
  (or `ghcr.io/x402-rs/x402-facilitator`).
- Key env vars: `RPC_URL_AVALANCHE_FUJI`, `RPC_URL_AVALANCHE`,
  `SIGNER_TYPE=private-key`, `EVM_PRIVATE_KEY`. If only the Fuji RPC
  URL is set, only Fuji is supported — which is exactly what this
  hackathon wants.
- The facilitator never holds user funds; it is a stateless
  verification + execution layer for signed payloads.
- **Take:** the fallback if a hosted facilitator is unstable, and the
  clearest statement of what a facilitator does and does not do.
- **Do not do:** run a self-hosted facilitator with a mainnet key, or
  build this before the hosted spike has been tried. Self-hosting is
  insurance, not the product.

Source: [x402-rs integration doc (ava-labs/builders-hub)](https://github.com/ava-labs/builders-hub/blob/HEAD/content/integrations/x402-rs.mdx)

### 1d. 0xgasless agent SDK — useful as a client reference, NOT as the treasury

- `@0xgasless/agent` gives an agent a stablecoin wallet, x402
  micropayments (EIP-3009 `TransferWithAuthorization` for USDC on
  Avalanche, Fuji and Base), an ERC-8004 identity link, and an audit
  log of verify/settle calls. Facilitator: `https://x402.0xgasless.com`.
- Free-tier caps in the source are $5 per call and $50 per day on Fuji,
  silently clamped to the tier ceiling.
- **Critical trade-off:** wallets are server-managed (keys in the
  platform KMS) and policy caps are enforced platform-side, not
  on-chain. That is fast, but it is weaker proof than a guard contract
  for a judging panel that asks "who enforces this if the platform is
  gone?"
- **Take:** the client-side flow (`payFetch`, max-value refusal,
  activity/audit rows with tx hashes) as a reference for the agent
  side of the hybrid.
- **Do not make it the core:** do not present platform policy as
  on-chain enforcement, and note in the README that the identity NFT
  in this SDK is minted to the sponsor wallet with the agent address
  in `agentURI` metadata — that is a different custody shape from a
  self-registered ERC-8004 identity.

Source: [0xgasless agent-sdk README](https://github.com/0xgasless/agent-sdk/blob/HEAD/README.md)

## 2. Guard pattern — the part that makes the hybrid defensible

### 2a. AgentVault (Stellar Soroban) — copy the pattern, NOT the code

AgentVault is on Stellar, so its Rust/Soroban code does not run on
Avalanche. What transfers directly is the design and the proof method:

- **Authority boundary:** "AI handles ambiguity; deterministic smart
  contracts own authority." The LLM parses messy quotes and proposes;
  the contract decides.
- **Zero-balance agent key:** the agent holds no treasury funds and can
  only call `propose()`. Everything else is an owner action.
- **Auto-execution rule (all three must hold):** recipient on the
  owner-governed allowlist (≤ 32 addresses in their design), amount
  ≤ per-tx cap (example 5.0 TUSDC), and rolling 23-hour spend
  ≤ daily cap (example 20.0 TUSDC).
- **Pending queue:** out-of-policy proposals (unknown payee, cap
  overflow, prompt-injection attempt) are halted and queued
  (max 25 in their design) for human approve/reject, with a TTL after
  which they expire.
- **Kill switch:** owner `pause()` freezes all outbound operations
  in one block.
- **Proof method worth stealing:** a controlled removal test. They ran
  the same attack against a naive hot-wallet vault (100% drained in
  1 transaction) and against the guarded vault (0 lost across 50
  attacks, blocked or queued). The hybrid demo should do the same on
  Fuji: naive agent wallet vs guarded vault, same attack script.
- **Do not copy:** Stellar-specific auth (`require_auth`), SAC asset
  transfers, hourly storage buckets, or the XLM fee/latency numbers.
  Those do not transfer to Fuji.

Source: [AgentVault README](https://github.com/Anekenonso/AgentVault)

### 2b. Wallie — copy the six pre-payment rails, note the chain limit

Wallie's six rails, all enforced *before* money moves, are the best
checklist for the hybrid pre-flight layer:

1. `kill_switch` — instant freeze, even mid-loop.
2. `host_not_allowlisted` — default-deny destination allowlist; a
   prompt injection redirecting the agent to an evil host moves nothing.
3. `per_call_cap` — price ceiling; an endpoint repricing itself to
   $5.00 is declined before signing.
4. `velocity_circuit_breaker` — rolling-window spend limit; a retry
   loop burns pennies, not thousands.
5. `budget_exhausted` — hard total cap, no overdraft.
6. `human_approval_required` — escalation gate; above a threshold,
   the purchase pends for explicit human approval instead of
   auto-executing.

Wallie also keeps an append-only audit ledger (`payment` / `blocked`
rows with rule, reason and tx hash) and a dashboard with blocked
attempts and a pending approval — exactly the audit ledger the hybrid
needs.

- **Chain limit — read this before planning:** Wallie's own page says
  live USDC support is on Base and Base Sepolia, with a Solana rail;
  it does not claim live Avalanche support. Use Wallie for the policy
  design and the demo script (their demo shows a runaway loop blocked
  at #150, an evil host blocked, and a mispriced call blocked), not
  as an Avalanche integration.
- **Scope limit in their own words:** limits apply only to payments
  routed through Wallie; existing metered invoices are outside scope.
  The hybrid README must state the same kind of boundary for its own
  guard (see section 5).

Source: [Wallie](https://www.onewallie.com/)

## 3. ERC-8004 identity + reputation — use testnet addresses, not mainnet ones

**Correction to earlier notes:** mainnet and testnet ERC-8004 addresses
are different. For Fuji, use the testnet pair below, and verify both on
`testnet.snowtrace.io` before use. Do not paste mainnet addresses into
a Fuji demo.

| Registry | Avalanche Testnet (Fuji) | Avalanche Mainnet (C-Chain) |
|---|---|---|
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

What to take from the official contracts repo:

- Identity Registry is ERC-721 based: `register()` gives an agentId
  and binds a payment wallet, so a gate can resolve a paying wallet
  to a known agent.
- Reputation Registry stores `giveFeedback` attestations; `getSummary`
  reads count/score. Feedback is a trust signal, not a Sybil-proof
  score — say so in the pitch.
- The repo ships ABIs, contracts, a spec (`ERC8004SPEC.md`) and a
  Hardhat setup. Use the ABIs; do not redeploy the registries unless
  there is a reason to.
- The registration file can carry an `x402Support` flag. That is the
  cleanest link between identity and payment in the whole pack.

**GateKeep's addresses are a different thing:** GateKeep (below)
deployed its own ERC-8004 registries on Fuji
(Identity `0xde9786b2…7EA7f73`, Reputation `0x34c2d005…05965421`
in its README, truncated there). Those are GateKeep's deployments,
not the canonical testnet pair above. Pick one set, document which
one, and do not mix them in the same demo.

Source: [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts)

## 4. GateKeep — the closest working reference for x402 + ERC-8004 on Fuji

GateKeep ("Stripe for AI agent API calls") was built for an Avalanche
Agentic Payments speedrun, live on Fuji, and is the single most useful
reference implementation in this pack — with one warning: it is a full
product (marketing site, seller dashboard, analytics, platform cut),
and the hybrid must not try to rebuild all of it.

**Take, in order of value:**

1. **The wire format, exactly:** unpaid request → `402` with an
   `accepts[]` entry (`scheme: "exact"`, `network: "avalanche-fuji"`,
   `maxAmountRequired` in atomic USDC units, `resource`, `payTo`,
   `asset`, `maxTimeoutSeconds`, `extra: { name: "USD Coin", version: "2" }`)
   → agent signs EIP-3009 `TransferWithAuthorization` (from, to,
   value, validAfter, validBefore, nonce) → retry with `X-PAYMENT`
   header → `200` + `X-PAYMENT-RESPONSE` carrying the tx hash.
2. **Two safety rules:** verify before serving and settle after;
   no money for nothing — if the upstream returns non-2xx, the agent
   is not charged; if settlement fails, the resource is withheld and
   a fresh 402 is returned.
3. **Mock vs real, labelled honestly:** GateKeep runs a mock mode
   (real EIP-712/EIP-3009 signatures verified cryptographically,
   settlement simulated) and a Fuji mode (real `transferWithAuthorization`
   with a Snowtrace tx hash). The hybrid demo must label its modes
   the same way. A mocked settlement presented as live is the fastest
   way to lose credibility with judges.
4. **Identity-aware gates:** a gate can require a verified agent and
   tier access by reputation, and every successful paid call writes
   feedback that builds the agent's on-chain track record. That is
   the hybrid's reputation step, already proven on Fuji.
5. **Fuji deployment pattern:** Circle Fuji USDC via
   `transferWithAuthorization`, test USDC from `faucet.circle.com`,
   AVAX for the facilitator from `faucet.avax.network`, and a
   one-line `USDC_ADDRESS` switch between MockUSDC and Circle USDC
   (same EIP-3009 interface).

**Do not copy:** the platform cut / revenue model, the analytics
dashboard scope, or the marketing site. The hybrid's demo needs a
playground and an audit ledger, not a billing business.

Source: [GateKeep README (x402-payment-gate)](https://github.com/anukulpandey/x402-payment-gate/blob/HEAD/README.md)

## 5. Honest boundaries to write into the hybrid README (judges check these)

1. **Treasury payouts** are enforced by the guard contract on-chain.
   **x402 tool payments** are enforced by the facilitator plus the
   pre-flight policy check before signing. Do not claim the guard
   contract controls x402 settlement unless the implementation
   actually does that.
2. **Reputation** in the MVP is feedback from a verified demo client
   after a completed call. It is not Sybil-proof, and the validation
   registry is out of scope.
3. **TalkMeter inside the hybrid** is one pre-approved tool (meeting
   summary charged per minute via x402), not a full meeting product.
   Real microphone capture is out of scope; a simulated session must
   be labelled simulated.
4. **Mock mode, if used for a rehearsal,** must be labelled mock in
   the video and the README. Live Fuji tx hashes are the evidence;
   screenshots alone are not.

## 6. Team1 starter code — check it before writing boilerplate

Team1's starter page says the working code to start from includes
parts of the Team1 site itself, two apps built from a few prompts,
a self-hosted maps backend, and a Privy agent wallet, and that you can
read the code, copy a file, or download the ZIP and build on it.

- **Action:** open `https://team1vn.xyz/demos.html` in a browser and
  download / copy from there. The page text alone does not expose a
  direct ZIP link, so do not guess one.
- **Take first:** the Privy agent wallet starter, if it matches the
  agent-wallet shape the hybrid needs. Everything else is optional.

Source: [Team1 starter code and demos](https://team1vn.xyz/demos.html)

## 7. Judging evidence — what actually gets checked

Official UniHack rubric (primary): Technical Implementation 25,
Avalanche Integration 25, Creativity & Innovation 15, Impact & Use
Case 15, Presentation & Pitching 10, UI/UX & Demo 10. Submission needs
a GitHub repo (private repos must add `tuantqse90`), pitch slides,
and a 2–3 minute demo video, with every link accessible to judges.

Secondary pattern from Avalanche hackathon guides (not UniHack
official, treat as a checklist, not a rule): deploy on Fuji, not
localhost; verify contracts on Snowtrace; show actual transactions
in a video under 3 minutes; include at least one Avalanche-unique
feature (x402 qualifies); working demo beats perfect code.

## 8. Source list — status at 2026-11-04

| Source | Status | Use for |
|---|---|---|
| Team1 site, Luma, Builder Hub listing | Official competition sources; dates/routes conflict — see `competition-context.md` | Deadline, submission, schedule |
| Team1 demos page | Official starter code pointer | Privy agent wallet starter |
| Ultravioleta DAO (Builder Hub) | Avalanche integration guide | Hosted x402 facilitator on Fuji |
| Thirdweb x402 (Builder Hub) | Avalanche integration guide | Hosted x402 facilitator + dashboard |
| x402-rs (ava-labs/builders-hub) | Open-source implementation | Self-hosted facilitator fallback |
| 0xgasless agent-sdk | Open-source client, platform-custodied | x402 client + audit-row reference |
| AgentVault | Open-source, Stellar (not EVM) | Guard pattern + proof experiments |
| Wallie | Open-source, live chains Base/Solana (not Avalanche) | Six pre-payment rails + audit ledger |
| GateKeep | Open-source, live on Fuji | x402 + ERC-8004 wire format + mock/real split |
| erc-8004/erc-8004-contracts | Official contracts repo | Canonical registry ABIs + addresses |
| Circle USDC address list | Official token list | Verify USDC addresses before use |

No private dashboard data, no teammate names, emails, invite links or
private keys are included in this pack.
