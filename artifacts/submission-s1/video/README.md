# MissionPay Demo Video Production Pipeline

This directory contains the post-production pipeline and deliverables for the **MissionPay S1 Hackathon Demo Video** (Round 13-C & 13-D).

---

## 1. Current pipeline (frame-stepped, Claude-built, 20/11)

The shipped `MissionPay-demo.mp4` is produced by three scripts in `scripts/video/`, not by the older screencast recorder:

```bash
# 1. Render each scene frame by frame from the live site (from apps/web so @playwright/test resolves).
#    Every frame is rendered on purpose: scroll, cursor and a one-way eased pan/zoom "camera"; no shake/jitter.
cd apps/web && node ../../scripts/video/render-scenes.mjs --out <dir> [--only s1a,s1b] [--preview]

# 2. Cross-fade (0.5 s xfade) the 19 scenes, place the 19 Puck r18 voice clips, duck Satie, burn captions.
python scripts/video/assemble-video.py --scenes <dir> --out artifacts/submission-s1/video/MissionPay-demo.mp4
```

- Scene length = voice clip + 0.8 s lead + 0.9 s tail; scenes overlap by 0.5 s, so the gap between two spoken lines is 1.2 s. No `atempo`, no `setpts` on footage.
- The voice is the 19 `clip_*_r18.wav` clips (Gemini TTS "Puck"); captions are their ASR text (`clip_*_r18.asr.txt`).
- `/judge`, `/bounty` (typing), `/verify` (tamper / restore) and the Twin Treasury table are the live deployment. Two scenes are stills: the Snowtrace receipt (`cards/snowtrace_frame.png`, a frame from our earlier live recording, because Snowtrace is behind a Cloudflare challenge for headless browsers) and the bounty result (`deck-shots/deck-bounty-tricked.png`, whose "RECORDED RUN" badge is part of the image).

The sections below describe the older (Round 13) pipeline and are kept for history.

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
