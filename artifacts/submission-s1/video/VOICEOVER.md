# MissionPay Video Demo Voiceover Script

**Total Video Target Duration:** ~2m 45s (Target Range: 2:40–2:55)  
**Total Word Count:** 126 words (Reviewer Target: $\le 150$ words)  
**Tone:** Confident, concise, technical, evidence-grounded.  
**Default TTS Voice:** `en-US-AndrewNeural` (Microsoft Edge TTS, free, no API key)  
**Alternative Track B:** `--voice owner.wav` (swaps in human presenter voice)

---

### Card 1: Title Card (0:00–0:03)
> "Same vendor. Same treasury. Two outcomes."  
*(6 words)*

---

### Card 2: Architecture Diagram (0:03–0:09)
> "Off-chain agents propose payouts, while Avalanche smart contracts enforce deterministic cryptographic limits."  
*(12 words)*

---

### Scene 0: Twin Treasury Live on Fuji (0:09–0:34)
> "On Avalanche Fuji, our Twin Treasury shows the difference: a global allowlist leaks funds, but MissionPay reverts the attack on-chain."  
*(20 words)*

---

### Scene 1: Judge Mode — Interactive Simulation (0:34–1:04)
> "In Judge Mode, test any attacker address: the smart contract strictly rejects it with PayeeNotInMissionSet, while legitimate payees succeed."  
*(20 words)*

---

### Scene 2: Bounty Arena Attack Flow (1:04–1:34)
> "In our public Bounty challenge, prompt injection fools the agent, but our dual-layer guard stops the payout with zero dollars lost."  
*(21 words)*

---

### Scene 3: Snowtrace On-Chain Revert Proof (1:34–1:59)
> "Snowtrace confirms the real transaction: execution strictly reverted on-chain with the custom error PayeeNotInMissionSet."  
*(16 words)*

---

### Scene 4: Client-Side Cryptographic Verifier (1:59–2:29)
> "Every step is cryptographically anchored. Tampering with a single byte instantly breaks the hash chain, turning the verifier red."  
*(19 words)*

---

### Card 3: Outro & Call to Action (2:29–2:45)
> "LLMs can be fooled. Budgets on Avalanche can't. Sign once, chain enforces."  
*(12 words)*
