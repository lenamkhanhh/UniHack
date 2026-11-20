# MissionPay Video Demo — Credits & Asset Licenses (Round 18)

This document lists all media assets, synthetic voices, music, and tools used in the production of the official **MissionPay** demo video for the Avalanche Team1 Vietnam UniHack 2026 Hackathon.

All third-party assets are free, open-source, or public domain, with permissive licenses allowing inclusion in a public repository and public video distribution.

---

## 1. Narration & Voice-Over (Synthetic)

- **Voice Model**: `gemini-3.1-flash-tts-preview`
- **Voice Preset**: `Puck` (calm, measured tech delivery, rate <= 1.9 words/s)
- **API Provider**: Google Generative AI (Gemini Developer API)
- **Audio Processing**: Custom build-time tail trimming (eliminated trailing burst click) + 40ms fade-out.
- **License**: Generated under Google AI terms for developer use and distribution.
- **Notice**: In compliance with hackathon regulations, the voice track is synthetic and fully disclosed here.

---

## 2. Background Music

- **Track Title**: *Gymnopédie No. 1*
- **Composer**: Erik Satie (1866–1925)
- **Audio Source**: Wikimedia Commons / Musopen
- **License**: Public Domain (Creative Commons Zero / CC-PD-Mark)
  - Work composition: Public Domain worldwide (composed 1888, author died > 70 years ago).
  - Performance recording: Public domain release via Musopen / Wikimedia Commons.
  - Link: https://commons.wikimedia.org/wiki/File:Erik_Satie_-_Gymnopedie_No_1.ogg

---

## 3. Video Assets & Fonts

- **Typography**: `Geist` and `Geist Mono` by Vercel
  - License: SIL Open Font License 1.1 (OFL)
  - Repository: https://github.com/vercel/geist-font
- **Visual Design**: Ink/Paper theme with Avalanche Red (`#E84142`), Cobalt Blue (`#2457C5`), and Charcoal Ink (`#0F1115`).
- **Icons & Badges**: SVG vectors designed custom for MissionPay under MIT License.

---

## 4. Production & Automation Pipeline

- **Recording Harness**: Playwright Automation (`record-demo.spec.ts`)
- **Video Assembly**: FFmpeg 6.0+ via Node.js / Python post-production scripts
- **Subtitles & Transcriptions**: Gemini 3.1 Flash Lite verbatim ASR verification
