# MissionPay Demo Video Production Pipeline

This directory contains the post-production pipeline and deliverables for the **MissionPay S1 Hackathon Demo Video** (Round 13-C & 13-D).

---

## 1. Quick Rebuild Commands

### Rebuild with Default Voiceover (Track A - Edge TTS):
```bash
# 1. Record the full 1080p demo with overlays & visual effects
npm run record:demo

# 2. Build final mastered video with title cards, xfades, audio, and subtitles
npx tsx scripts/video/build-video.ts
```

### Rebuild with Presenter Voice (Track B - Human Recording):
```bash
# Provide custom voice recording (e.g. owner.wav or owner.mp3)
npx tsx scripts/video/build-video.ts --voice path/to/owner.wav
```

---

## 2. Deliverables Checklist

| Artifact | File | Status | Notes |
| :--- | :--- | :---: | :--- |
| **Final Video** | `MissionPay-demo.mp4` | Generated | 1080p30 H.264 + AAC, target 2:40–2:55, < 50 MB |
| **Subtitles** | `captions.srt` | Generated | EBU standard timestamps matching scene flow |
| **Voiceover Script** | `VOICEOVER.md` | Generated | 126 words ($\le 150$ word target), confident & technical |
| **Scene Manifest** | `scenes.json` | Generated | Complete scene markers and lower-third metadata |
| **Title Cards** | `cards/` | Generated | 1920x1080 HTML/PNG: Intro, Architecture SVG, Outro QR |

---

## 3. Post-Production Features (Round 13-D)

1. **In-Recording Visual Overlays (`apps/web/e2e/video/record-demo.spec.ts`)**:
   - **Spotlight & Zoom**: Automatically dims background and scales key evidence elements (e.g. `PayeeNotInMissionSet` on-chain revert badge, 0.01 USDC delta, tampered signature mismatch) to $1.35\times$ for 2.5–3 seconds with glowing Avalanche red ring.
   - **Lower-Third Broadcast Labels**: Clean broadcast lower-thirds showing scene context, chain ID, and live Fuji transaction hashes.
   - **Click Ripple Effect**: Pulsing radial wave expanding from every pointer click.
   - **Burned Caption Pill**: Centered floating subtitle pill with blurred translucent backdrop.

2. **Title & Illustration Cards (`artifacts/submission-s1/video/cards/`)**:
   - **Intro Card (3.5s)**: Brand shield logo, "#0B0F17" dark theme, Avalanche "#E84142" accent, "Same vendor. Same treasury. Two outcomes."
   - **Architecture Diagram (6.0s)**: High-resolution animated SVG showing Agent $\to$ Mission Validator $\to$ GuardedTreasury with Merkle payee set and instant on-chain revert branch.
   - **Outro Card (6.5s)**: High-contrast QR codes directly linking to `/judge` and `/bounty`, punchline *"LLMs can be fooled. Budgets on Avalanche can't."*, and Fuji contract address.

3. **Audio Engineering**:
   - Multi-segment timeline mixing with EBU R128 loudness normalization (`loudnorm=I=-16:TP=-1.5:LRA=11`).
   - Supports zero-cost instant generation via `edge-tts` (`en-US-AndrewNeural`) or seamless replacement with owner audio track via `--voice`.

4. **Honesty & Grounding**:
   - All addresses, numbers, and transaction hashes shown on screen are 100% real and grounded in `JUDGE_QA.md` Section 1.
