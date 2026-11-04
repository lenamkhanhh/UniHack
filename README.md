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

Product: **Guarded Agent Economy** — agent proposes only, a guard contract enforces policy on Fuji, out-of-policy proposals queue for a human, tool purchases settle via x402, and the agent carries an ERC-8004 identity + reputation. Built in stages so the Rails + TalkMeter slice (Stage 1) is submittable even if the guard stage slips: read the files in numeric order, and use the shared constants in `00-overview.md` §8 everywhere — do not invent different caps, addresses, or prices.

- [00 — Overview, staged pipeline, architecture, rubric mapping, shared constants](pipeline/00-overview.md)
- [01 — Guard contract spec: GuardedTreasury on Fuji](pipeline/01-contracts.md)
- [02 — x402 tool marketplace + TalkMeter metered billing](pipeline/02-x402-tools.md)
- [03 — ERC-8004 Identity + Reputation on Fuji](pipeline/03-erc8004.md)
- [04 — Agent proposer, 12-rule pre-flight validator, human queue, hash-chained audit ledger](pipeline/04-agent.md)
- [05 — App, API, DB, UI, and submission repo layout](pipeline/05-app.md)
- [06 — Test matrix T1–T12, attack test with a naive-vault control, security checklist](pipeline/06-tests-security.md)
- [07 — Demo script (6 scenes, 2:30), video, slides, submission checklist](pipeline/07-demo-submission.md)
- [08 — Day-by-day build plan to 21/11, work split, GPT review checklist](pipeline/08-build-plan.md)
- [09 — Creative breakthroughs in priority order, and what NOT to build](pipeline/09-breakthroughs.md)

Honest limits (kept in every pitch, video, and README): reputation is a trust signal, not Sybil-proof; TalkMeter here is a per-minute paid tool, not a full meeting product; the MVP daily cap is a UTC day, not a rolling window; mock mode must always be labelled mock; testnet only, no mainnet keys or funds.

## Official links

- [Team1 Vietnam UniHack](https://team1vn.xyz/)
- [Team1 Vietnam on Luma](https://luma.com/Team1VN)
- [Avalanche Builder Hub event listing](https://build.avax.network/events/596c0b2d-63aa-4cf0-a0ad-a7e34ddbfdc0)

This is a research summary, not an organizer notice. Verify dates and submission instructions with the organizers before relying on them.
