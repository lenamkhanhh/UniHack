# MissionPay Video Demo — Credits & Asset Licenses

This document lists all media assets, synthetic voices, music, and tools used in the production of the official **MissionPay** demo video for the Avalanche Team1 Vietnam UniHack 2026 Hackathon.

All third-party assets are free, open-source, or public domain, with permissive licenses allowing inclusion in a public repository and public video distribution.

---

## 1. Narration & Voice-Over (Synthetic)

- **Voice Model**: `gemini-2.5-flash-preview-tts`
- **Voice Preset**: `Puck` (high-energy, clear tech-demo delivery)
- **Provider**: Google Gemini API (Multimodal Audio Output)
- **Notice**: In accordance with competition rules and ethical disclosure, the narration voice-over is **100% synthetic**. Zero human voice actors and zero unauthorized third-party recordings were used.

---

## 2. Background Music

- **Title**: *Gymnopédie No. 1: Lent et douloureux*
- **Composer**: Erik Satie (1888, Public Domain)
- **Performer**: Robin Alciatore (Piano)
- **Publisher**: Musopen (https://musopen.org/)
- **Repository**: Wikimedia Commons ([File:Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg](https://commons.wikimedia.org/wiki/File:Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg))
- **License**: **Public Domain (CC0 / PD 1.0 Universal)**
- **Mix**: Mixed at volume 0.32 with dynamic sidechain ducking (-24 dB under voice), smooth intro fade-in (2s), outro fade-out (3.5s), and mastered to EBU R128 (-16 LUFS).

---

## 3. Production & Tooling

- **Video Capture & Automation**: Playwright (1080p Chromium headless recording)
- **Assembly Pipeline**: Python audio processing (`wave` module, sample-accurate PCM placement)
- **Audio Mastering & Encoding**: FFmpeg 9.0 (`sidechaincompress`, `amix`, `loudnorm`, libx264, AAC 48 kHz)
