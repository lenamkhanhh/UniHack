# UniHack — Avalanche Team1 Vietnam UniHack 2026

Research bundle prepared on **4 November 2026** to help an AI research assistant find and cross-check the competition context.

## Quick facts

- A 30-day student build program on Avalanche, scheduled for 2–30 November 2026.
- Vietnamese university students from any major may participate; joining and building are free, and teams may have up to three people.
- Projects may use an Avalanche L1, Fuji testnet, or C-Chain mainnet. The suggested ideas are optional.
- Team1’s current website and Luma schedule say submissions close **21 November at 23:59 Vietnam time**. The Avalanche Builder Hub listing shows a different deadline, venue, and submission path. See [the discrepancy note](context/competition-context.md#official-source-conflicts).
- The authenticated participant dashboard snapshot reviewed for this research showed a two-person team on the Agent Economy (x402) track and no submission yet. Personal names, contact details, invite links, and pending applicant identities are intentionally excluded from this public repository.

## Research files

- [Competition overview, schedule, rules, prizes, and source conflicts](context/competition-context.md)
- [All 20 suggested project ideas with plain-language MVP sketches](context/idea-catalog.md)
- [Source and registration link index](context/source-index.md)
- [Build sources: curated x402, guard, ERC-8004 and Fuji references — what to copy and what not to copy](context/build-sources.md)
- [Spike checklist: 2-day pass/fail test for hybrid vs Rails + TalkMeter, with proof tests and demo script](context/spike-checklist.md)

## Full product pipeline — for GPT review, then Gemini implementation

Product: **Guarded Agent Economy** — use-case axis: a research group / club assigns an agent a budgeted mission; the agent buys tools to complete it; every spend reconciles against the granted permission and the result received. Agent proposes only, a guard contract enforces policy on Fuji, out-of-policy treasury proposals queue for a human, tool purchases settle via x402 (no human queue for tools in MVP), and the agent carries an ERC-8004 identity + reputation from the mission owner. Built in stages so the Rails + TalkMeter slice (Stage 1, with its own submission pack) is submittable even if the guard stage slips: read the files in numeric order, and use the shared constants in `00-overview.md` §8 everywhere — do not invent different caps, addresses, or prices.

- [00 — Overview, staged pipeline, architecture, rubric evidence (no score prediction), shared constants](pipeline/00-overview.md)
- [01 — Guard contract spec: GuardedTreasury on Fuji, mission on-chain, hard vs soft checks, state machine](pipeline/01-contracts.md)
- [02 — x402 tool marketplace + TalkMeter metered billing + operation lifecycle, idempotency, reservation, recovery](pipeline/02-x402-tools.md)
- [03 — ERC-8004 Identity + Reputation on Fuji, correct ABI (getSummary 4 params, readFeedback/readAllFeedback), mission-owner feedback](pipeline/03-erc8004.md)
- [04 — Agent proposer, BLOCK-before-QUEUE validator, mission, human queue, hash-chained audit ledger with canonical encoding](pipeline/04-agent.md)
- [05 — App, API, DB, UI, and submission repo layout — Vercel + hosted Postgres, MetaMask owner txs, mission token for agent txs](pipeline/05-app.md)
- [06 — Test matrix split into contract (forge), validator/API integration, and live Fuji smoke; attack test with a naive-vault control + positive control](pipeline/06-tests-security.md)
- [07 — Demo script (6 scenes, 2:30), video, slides, submission checklists split for S1 vs S2/S3](pipeline/07-demo-submission.md)
- [08 — Day-by-day build plan to 21/11, work split, GPT review checklist](pipeline/08-build-plan.md)
- [09 — Core evidence (proof bundle, mission budget display) vs stretch in priority order, and what NOT to build](pipeline/09-breakthroughs.md)
- [10 — Review-response: verdicts (ACCEPT / PARTIAL / REJECT / ALREADY FIXED) for 12 GPT suggestions, with spec paths and official sources, plus addendum A1–A5 for the second small review (nonce recovery, S1 auth/pause, operation persistence, LLM vs key compromise, operation binding)](pipeline/10-review-response.md)
- [11 — Gemini handoff: product, invariants (I1–I14), implementation order, stage gates, fallback, test locations, locked decisions](pipeline/11-gemini-handoff.md)

Honest limits (kept in every pitch, video, and README): reputation is a trust signal, not Sybil-proof, and MVP feedback is a quality rating from the mission owner, not a success rate of all calls; TalkMeter here is a per-minute paid tool, not a full meeting product; the MVP daily cap is a UTC day (with a midnight-boundary gap), not a rolling window; pause does not cancel an x402 authorization already signed within its 60s TTL, and does not stop a key holder signing directly; LLM compromise and private-key compromise are different threats — toolCap off-chain does not hold against a key holder, whose tool loss is bounded by the tool wallet balance plus refills, not by toolCap; UNKNOWN is not FAILED or SETTLED by itself — only a settlement receipt (or a reconciled expiry + unused nonce) concludes it; S1 has no guard, its owner/auth/pause are off-chain; the hash chain proves ledger integrity/consistency, not trustlessness or answer quality; mock mode must always be labelled mock; testnet only, no mainnet keys or funds.

## Official links

- [Team1 Vietnam UniHack](https://team1vn.xyz/)
- [Team1 Vietnam on Luma](https://luma.com/Team1VN)
- [Avalanche Builder Hub event listing](https://build.avax.network/events/596c0b2d-63aa-4cf0-a0ad-a7e34ddbfdc0)

This is a research summary, not an organizer notice. Verify dates and submission instructions with the organizers before relying on them.
