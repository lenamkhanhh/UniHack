# Brief for Claude Design: MissionPay landing page (start from v6)

Attach: `index-v6.html` (current direction) and `mockup-v6-desktop.png`.

## Prompt to paste

Redesign this landing page for MissionPay, a hackathon project (Avalanche Team1 Vietnam UniHack 2026). Keep the structure, content and every number exactly as they are; make the visual design more polished and distinctive.

What it is: a spend guard for AI agents. The owner signs which payees a mission may pay; the agent can only propose; a smart contract on Avalanche (GuardedTreasury) rejects any payout outside the signed set, even a vendor already on the company allowlist. Audience: hackathon judges who will spend 30–60 seconds on the page.

Keep:
- Sections, in order: hero with a product composite on an Avalanche-red panel; "Three objects decide every payout"; Table 1 (twin result, dark band); "Ask the contract" (interactive check); Table 2 (results); known limits; footer.
- Tone: fintech/infra (Ramp, Privy, Turnkey), tables like a research paper or Kaggle leaderboard. Numbers in tables at normal size, not giant stats.
- Colour by meaning: red = blocked/Avalanche brand, green = paid/allowed. Section tints: sand, dark, light red, slate.
- Font: Geist + Geist Mono (mono only for hashes and addresses).
- All copy, all tx hashes and all numbers verbatim. Do not add metrics, testimonials, logos of customers, or claims.

Improve:
- Typographic hierarchy and rhythm; tighten spacing where it feels empty.
- The hero product composite (mission card, payout queue, on-chain revert receipt) should feel like a real product UI.
- The three object illustrations (signed mission, agent proposal, PAY/REVERT gate).
- Make Table 1 the memorable moment without enlarging numbers.

Avoid: purple/blue gradients, neon glow, glassmorphism, eyebrow pills on every heading, 01/02/03 numbering, emoji, stock illustrations, fake data.

Deliver: desktop 1440 and mobile 390, accessible contrast, visible focus states.
