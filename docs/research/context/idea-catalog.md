# Suggested idea catalog

The official page lists 20 optional topics. The short descriptions below explain the core mechanic and a small demo scope; they are interpretations to help compare ideas, not extra organizer requirements. The source page displays labels from 2/5 to 5/5 beside topics but does not explain the scale, so this document does not treat those numbers as confirmed difficulty ratings.

## Social finance

1. **Hụi on-chain (ROSCA) — site label 2/5.** A rotating savings circle whose contributions and payout order are enforced by a contract. A small demo can create a group, collect periodic deposits, and show who receives the pooled amount next.
2. **Split-bill Vault — 2/5.** A shared group vault for logged expenses and USDC settlement. MVP: add members, record who paid, calculate balances, and settle; an optional extension puts idle funds in a yield vault.
3. **Commitment Stake — 2/5.** A deposit discourages event no-shows. RSVP with a stake, check in by QR for a refund, and distribute forfeited stakes to attendees.
4. **Allowance Vault — 3/5.** Parents deposit a semester budget; a smart-account policy releases an allowance weekly. MVP: deposit, schedule, and claim weekly amounts.
5. **Transparent Charity — 3/5.** Accept USDC donations, release money by milestone through a multisig, and record receipt hashes. A demo can show donations, milestone approval, and an auditable expense history.
6. **Quadratic Funding for student projects and clubs — 3/5.** A matching pool allocates more support to projects backed by more distinct contributors, rather than only larger donations. The matching calculation and duplicate-account resistance are the hard parts.
7. **Streak-based gamified savings — 2/5.** Regular deposits maintain a savings streak and improve the user’s share of yield; missing a week resets the streak. MVP: deposits, weekly streak state, and reward calculation.
8. **Streaming payroll + milestone escrow — 3/5.** Freelancer pay streams over time or releases when milestones are reached, with a dispute window. MVP: escrow, milestone approval, and claimable pay.
9. **Capped-resale NFT tickets with yielding float — 3/5.** Ticket resale is capped at face value plus 10%; ticket funds can earn yield until event day, with a refund pool if the event is cancelled. Several integrations make the full version larger than a basic ticket demo.

## Game on L1

10. **YieldGO — 5/5.** A map-based walk-to-onboard game where players discover chests connected to DeFi positions; on-chain positions influence character stats. A narrow MVP should use a few fixed map locations and a small set of chest actions.
11. **DeFi Farm — 4/5.** A farming game maps deposits to planting, accruing yield to crop growth, and withdrawals to harvest; seasons represent lock periods. The demo must make the on-chain financial mechanic visible, not only the farm interface.

## AI agents and security

12. **AI agent treasury with on-chain guardrails — 3/5.** An agent proposes or performs treasury actions, but a contract enforces a daily cap, token/protocol whitelist, and kill switch. The core demo is an allowed action succeeding and a disallowed action being rejected.
13. **DeFi Copilot — 3/5.** A natural-language assistant reads DeFi data and can prepare actions that pass through a limited allowance. It should explain positions without pretending to forecast prices. Include a small evaluation set for common requests.
14. **Tx Guardian — 3/5.** Simulate a transaction on a fork before signing, explain the outcome, and flag risks such as unlimited approvals, lookalike addresses, or drain patterns. The challenging part is reliable simulation and accurate risk explanations.
15. **PayrollFloat (listed as topic 21) — 4/5.** An agent seeks yield on idle payroll funds and unwinds positions in time to pay employees on payday. The key demo is the withdrawal schedule and proof that liquidity is available when due.

## Agent economy on x402

16. **StockAgent Launchpad — 4/5.** A launchpad for agents managing tokenized-stock portfolios, with progress judged by on-chain track record and non-custodial delegation. A small hackathon demo should use simulated assets and avoid claiming real investment performance.
17. **x402 Micropayment Rails on Avalanche — 3/5.** A facilitator and SDK let an API or content site charge USDC per request using HTTP 402 Payment Required. MVP: request gets a 402 payment challenge, client pays on Fuji, server verifies payment, and the API returns the response.
18. **ActorBazaar — 5/5.** A marketplace for agent tools (“Actors”) that run in a sandbox and charge buyers per use through x402. Arbitrary code execution and sandbox security are the hardest parts; a constrained demo can offer a few preapproved Actors.
19. **TalkMeter — 3/5.** A meeting copilot charges by the minute while a session is active, with a budget cap. MVP can demonstrate start/stop billing and a session summary; real microphone capture is optional for a prototype.
20. **AskPay — 3/5.** A Vietnamese-law Q&A agent charges only when it can provide a verified citation to the relevant article and clause; a wrong citation triggers a refund. Keep the legal corpus narrow and make citation checking explicit.

## Quick comparison for a short build window

- **Most direct fit to the selected x402 track:** x402 Micropayment Rails. The payment handshake is easy to demonstrate end to end.
- **Product/UI-focused alternative:** TalkMeter. Keep the billing flow small and simulate a session if audio integration distracts from the payment demo.
- **AI-heavy alternative:** AskPay or Tx Guardian. Both need reliable evidence or simulation, so narrow the domain early.
- **Largest scope risks:** ActorBazaar, YieldGO, and StockAgent Launchpad. Their full versions require sandboxing, maps/game design, or complex agent/asset flows.

These are scoping recommendations based on the descriptions and listed labels, not official organizer rankings.
