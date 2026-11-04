# Spike checklist — 2 days to decide hybrid vs Rails + TalkMeter

**Note (review 2026-11-04, pipeline/10-review-response.md):** this
checklist is the spike shorthand. The full, authoritative test matrix
is `pipeline/06-tests-security.md` with C (contract/forge), V
(validator/API integration), and L (live Fuji) series. T-numbers
below map to 06 §1–§3; where they differ, 06 wins. Do not treat
this file as a second test spec.

**Decision rule (agreed 2026-11-04):** run this spike first. If every
gate below passes, build the Guarded Agent Economy hybrid. If the
guard contract or the x402 facilitator is still stuck after 2 days,
cut to the Rails + TalkMeter slice — which is already the working
part of the hybrid, not a restart. Rails + TalkMeter (S1) still gets
its own submission pack (pipeline/07 §4b) even if the guard is cut.

**Scope for the spike:** one club/lab treasury, testnet only, 2–3
pre-approved tools, no mainnet, no token launch, no yield, no
arbitrary-code sandbox, no real microphone capture.

## Day 1 gates — Fuji + x402 + identity (all must pass)

- [ ] Wallet created for the demo (fresh test wallet, never a real wallet).
- [ ] AVAX received from `https://faucet.avax.network`.
- [ ] Test USDC received from `https://faucet.circle.com`, on Fuji
      (chain 43113), at `0x5425890298aed601595a70AB815c96711a31Bc65`.
      Confirm 6 decimals: $0.50 = `500000` atomic units.
- [ ] RPC works: `https://api.avax-test.network/ext/bc/C/rpc`.
- [ ] One unpaid request returns `402` with a valid `accepts[]` entry
      (network `avalanche-fuji`, amount, resource, payTo, asset,
      timeout, EIP-712 domain `USD Coin` v2).
- [ ] One paid request completes the round-trip: sign EIP-3009
      `TransferWithAuthorization` off-chain → retry with `X-PAYMENT`
      → `200` + `X-PAYMENT-RESPONSE` carrying a real Snowtrace tx hash.
- [ ] Facilitator choice recorded: hosted (Ultravioleta or Thirdweb)
      or self-hosted (x402-rs), **plus x402 version + scheme actually
      used** (v1 `exact` expected, but record what actually worked —
      do not assume v1 works with a facilitator that only supports v2).
      If the hosted facilitator is unstable, switch to the fallback
      on Day 1, not in the final week.
- [ ] ERC-8004 testnet registries readable on Fuji:
      Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`,
      Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`.
      Verify both on `testnet.snowtrace.io` before use. Do not use
      the mainnet pair on Fuji.
- [ ] One agent identity registered (or read back) with its agentId
      and payment wallet visible.

**Day 1 fail →** do not start the guard contract yet. Fix the
facilitator / faucet / address first. A guard with no working
payment rail is not a demo.

## Day 2 gates — guard contract + proof (all must pass)

Deploy a minimal guard contract on Fuji with: owner-only policy
changes, agent role that can only propose, per-tx cap, daily cap
(UTC-day window for the MVP — simpler to test and explain than a
rolling window), USDC-only, recipient allowlist, **mission on-chain
(createMission, expiry, agent assignment — no mission-less payout)**,
pending queue, `pause()` / `unpause()`, and events for Proposed /
Executed / Queued / Approved / Paused. **No Blocked event** (a revert
erases events — blocks are recorded off-chain in the audit ledger).
**No toolAllowlist in the guard** (tool allowlist is off-chain only).

Each test must produce a tx hash or a clean revert, not a UI mock:

- [ ] T1. Within policy: allowlisted recipient, amount ≤ per-tx cap,
      daily total ≤ daily cap → executes on-chain.
- [ ] T2. Over per-tx cap → does not execute; proposal lands in the
      pending queue.
- [ ] T3. Over daily cap (after T1) → queues, does not execute.
- [ ] T4. Non-allowlisted recipient → blocked, never queued as
      auto-executable.
- [ ] T5. Lookalike recipient (same first/last characters as an
      allowlisted address, different full address) → blocked. The
      check must compare the full address, never a prefix/suffix.
- [ ] T6. Unlimited approval request → blocked. A specific-amount
      approval for the same tool passes the approval check.
- [ ] T7. Owner approves a queued proposal → executes; owner rejects
      a queued proposal → stays unexecuted and is marked rejected.
- [ ] T8. Owner calls `pause()` → a subsequent in-policy proposal
      does not execute. `unpause()` restores execution.
- [ ] T9. Agent key cannot call owner functions (set policy, approve,
      pause, withdraw). A direct call reverts.
- [ ] T10. Agent key cannot drain the treasury directly: a direct
      transfer attempt from the agent key moves 0 funds.
- [ ] T11. Controlled removal test: the same attack script against a
      naive agent wallet (funded key, no guard) drains it, and
      against the guarded vault loses 0 to the attacker (blocked or
      queued). Record both tx hashes.
- [ ] T12. Audit ledger: every proposal, execution, block, queue,
      approval and pause appears with rule, reason and tx hash (block
      entries have no tx hash by design — they were blocked before signing).
- [ ] T13. Mission gate: propose without a mission, with an expired
      mission, or with the wrong agent → revert.
- [ ] T14. Operation gate: same operationId + same input → same
      receipt, no double charge; TalkMeter duplicate tick → old receipt.
- [ ] T15. State-machine gate: approve/execute after expiry revert;
      duplicate execute reverts; recipient removed after queue →
      execute reverts.

**Day 2 fail →** cut to Rails + TalkMeter. Do not spend the rest of
the week debugging the guard while the x402 slice is already working.

## Demo script — 6 scenes, 2 minutes 30 seconds max

Use the same script for the hybrid; the Rails + TalkMeter fallback
uses scenes 1, 2 and 6 only (with scene 6 reframed as the meeting
billing demo).

1. **Discover (20s):** show the agent's ERC-8004 identity and
   reputation summary. Evidence: agentId + Snowtrace link.
2. **Pay a tool via x402 (25s):** agent buys a pre-approved tool
   ($0.50 example). Evidence: `402 → sign → 200` + settlement tx hash.
3. **Treasury payout in policy (25s):** transfer to an allowlisted
   member within caps. Evidence: guard execution tx hash.
4. **Over cap → queue → human approves (35s):** the same transfer
   above the cap queues, the owner approves, it executes.
   Evidence: queue tx/event + approval tx + execution tx.
5. **Attack blocked + positive control (25s):** lookalike recipient
   or unlimited approval. Evidence: revert / audit BLOCKED + rule,
   0 funds to attacker, then a valid request succeeds (proving the
   system does not "block everything").
6. **Kill switch (20s):** owner pauses; a new in-policy attempt is
   blocked until unpaused. Evidence: pause tx + blocked attempt.
   State the limit: pause does not cancel an x402 authorization
   already signed within its 60s TTL.

Fill in before submission (do not submit with blanks):

- Guard contract address (Fuji): _______________
- Fuji USDC used: `0x5425890298aed601595a70AB815c96711a31Bc65`
- ERC-8004 Identity (Fuji testnet): `0x8004A818BFB912233c491871b3d84c89A494BD9e`
- ERC-8004 Reputation (Fuji testnet): `0x8004B663056A597Dffe9eCcC1965A193B7388713`
- Facilitator used + x402 version/scheme actually used: _______________
- Mission demo (slug, treasury cap, tool cap, expiry): _______________
- Demo tx hashes: _______________
- Audit checkpoint hash (last entry): _______________

## Cut rules — freeze scope on 17 November

- After 17 November: no new features, no new tools, no new chains.
- Only 2–3 pre-approved tools. A fourth tool is not worth a broken demo.
- Reputation feedback is the only allowed stretch, and only after
  the S2 gates (contract + validator) pass. It is feedback from the
  mission owner after a SETTLED operation, not a Sybil-proof score,
  and not a success rate of all calls.
- If a scene cannot be shown live on Fuji, label it simulated in the
  video and README. Never present a mock settlement as a live tx.

## Security rules — testnet only

- No real private key, seed phrase, API secret or mainnet wallet in
  the repo, in slides, or in the video.
- `.env` is gitignored. Example env files use placeholder addresses only.
- The agent key holds no treasury funds. The guard contract holds the
  funds; the agent only proposes.
- Private repos submitted to judges must add `tuantqse90` as a
  collaborator, and every slide/video link must be accessible in an
  anonymous browser check before pressing Submit.

## Submission checklist (condensed from competition-context.md)

- [ ] GitHub repo link works (private → `tuantqse90` added).
- [ ] Pitch slides link works anonymously.
- [ ] Demo video is 2–3 minutes and shows real Fuji transactions.
- [ ] README lists contract addresses, facilitator, and tx hashes.
- [ ] README states the honest boundaries: guard enforces treasury
      payouts on-chain; x402 settlement is enforced by the
      facilitator + pre-flight check before signing.
- [ ] Draft saved, then Submit pressed before 21 November 23:59
      Vietnam time. A draft alone does not count.
