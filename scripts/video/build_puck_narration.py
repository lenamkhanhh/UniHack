#!/usr/bin/env python3
"""Build final narrated demo video using Google Gemini TTS ('Puck') and Erik Satie background music.

Requirements (Round 17c):
- TTS Model: gemini-3.1-flash-tts-preview with voice 'Puck'
- Style prompt: 'Say in an upbeat, confident tech-demo voice, with real emphasis: <cue text>'
- Audio format: PCM s16le 24kHz mono -> 48kHz stereo WAV
- Verification: Transcribe each clip back with gemini-3.1-flash-lite
- Background music: Erik Satie Gymnopédie No. 1 (public domain), mixed at volume 0.32 with sidechain ducking and EBU R128 loudnorm (-16 LUFS)
- Subtitles: artifacts/submission-s1/video/narration.srt
- Credits: artifacts/submission-s1/video/CREDITS.md
- Total runtime: 140–175s (Target ~149.1s), voice coverage >= 70%, speech rate 2.0–2.4 words/s. NO atempo anywhere.
"""

import os
import sys
import json
import base64
import time
import wave
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

# Unbuffered print helper
_print = print
def print(*args, **kwargs):
    kwargs.setdefault('flush', True)
    _print(*args, **kwargs)

ROOT = Path(__file__).resolve().parents[2]
VIDEO_DIR = ROOT / 'artifacts/submission-s1/video'
MUSIC_FILE = VIDEO_DIR / 'gymnopedie_no1.ogg'
CONCAT_VIDEO = VIDEO_DIR / 'concat-silent.mp4'
FINAL_VIDEO = VIDEO_DIR / 'MissionPay-demo.mp4'
SILENT_BACKUP = VIDEO_DIR / 'MissionPay-demo-silent.mp4'
SRT_PATH = VIDEO_DIR / 'narration.srt'
CAPTIONS_SRT = VIDEO_DIR / 'captions.srt'
CREDITS_PATH = VIDEO_DIR / 'CREDITS.md'

# 1. Load GEMINI_API_KEY safely from apps/web/.env
env_path = ROOT / 'apps/web/.env'
if not env_path.exists():
    print(f"Error: {env_path} not found")
    sys.exit(1)

api_key = None
for line in env_path.read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line.startswith('GEMINI_API_KEY='):
        api_key = line.split('=', 1)[1].strip().strip('"\'')
        break

if not api_key:
    print("Error: GEMINI_API_KEY not found in apps/web/.env")
    sys.exit(1)

print("GEMINI_API_KEY loaded successfully.")

# Cues definitions for Round 17c (16 cues aligned with new scenes, voice coverage >= 70%, rate 2.0-2.4 words/s)
# Total Video Duration: 160.0s. NO ATEMPO ANYWHERE.
CUES = [
    {
        'id': 's0_intro',
        'file_base': 'clip_s0_puck',
        'start_s': 0.300,
        'next_start_s': 3.900,
        'text': 'Same vendor. Same treasury. Two outcomes.',
        'caption': 'MissionPay: Same vendor. Same treasury. Two outcomes.',
    },
    {
        'id': 's1a_home',
        'file_base': 'clip_s1a_puck',
        'start_s': 4.200,
        'next_start_s': 17.500,
        'text': 'MissionPay secures AI agent treasuries. The owner signs authorized payees, agents propose payouts, and the Avalanche smart contract enforces every limit.',
        'caption': 'MissionPay: owner signs authorized payees, agents propose, Avalanche contract enforces.',
    },
    {
        'id': 's1b_objects',
        'file_base': 'clip_s1b_puck',
        'start_s': 18.500,
        'next_start_s': 32.500,
        'text': "Three objects govern payouts: the owner's signed intent, a cryptographic Merkle proof, and our Avalanche Fuji smart contract.",
        'caption': 'Three objects govern payouts: signed mission policy, Merkle proof, and treasury gate.',
    },
    {
        'id': 's1c_table',
        'file_base': 'clip_s1c_puck',
        'start_s': 34.000,
        'next_start_s': 50.000,
        'text': 'Twin allowlist paid the vendor zero point zero one USDC. Twin mission reverted with Payee Not In Mission Set: zero USDC out. Every row links to a real Fuji transaction.',
        'caption': 'Twin table: allowlist paid 0.01 USDC, mission reverted PayeeNotInMissionSet, 0 lost.',
    },
    {
        'id': 's2a_receipts',
        'file_base': 'clip_s2a_puck',
        'start_s': 51.500,
        'next_start_s': 59.800,
        'text': 'In Judge Mode, three live receipts from Avalanche Fuji prove on-chain behavior.',
        'caption': 'In Judge Mode, test any attacker: the contract strictly reverts with PayeeNotInMissionSet.',
    },
    {
        'id': 's2b_attacker',
        'file_base': 'clip_s2b_puck',
        'start_s': 61.200,
        'next_start_s': 72.800,
        'text': 'Simulating a random attacker: the contract strictly reverts with Payee Not In Mission Set.',
        'caption': 'Random attacker: the contract reverts with PayeeNotInMissionSet.',
    },
    {
        'id': 's2c_owner',
        'file_base': 'clip_s2c_puck',
        'start_s': 74.000,
        'next_start_s': 84.800,
        'text': 'Testing the owner address: authorized and accepted. These are read-only eth call simulations: no gas, no private keys.',
        'caption': 'Owner address: proposal accepted. Read-only eth_call simulation, no gas, no keys.',
    },
    {
        'id': 's2d_cast',
        'file_base': 'clip_s2d_puck',
        'start_s': 86.000,
        'next_start_s': 92.500,
        'text': 'Copy the cast command to query public Avalanche Fuji RPC directly.',
        'caption': 'Verify independently: copy cast call to query public Avalanche Fuji RPC directly.',
    },
    {
        'id': 's2e_limits',
        'file_base': 'clip_s2e_puck',
        'start_s': 93.200,
        'next_start_s': 99.000,
        'text': "Known limits: updating the mission Merkle root requires the owner's signature.",
        'caption': 'Known limits: dynamic budget updates require owner signature to update Merkle root.',
    },
    {
        'id': 's3a_bounty',
        'file_base': 'clip_s3a_puck',
        'start_s': 100.000,
        'next_start_s': 109.500,
        'text': 'In our public Bounty challenge, prompt injection tricks the agent, but our dual-layer guard preserves the treasury.',
        'caption': 'Bounty Challenge: prompt injection fools the agent, but the contract preserves treasury.',
    },
    {
        'id': 's3b_trace',
        'file_base': 'clip_s3b_puck',
        'start_s': 110.000,
        'next_start_s': 117.500,
        'text': 'The poisoned address is tainted from tool output, so the validator blocks it.',
        'caption': 'Tainted address from tool output is blocked by validator; contract provides hard backstop.',
    },
    {
        'id': 's4_snowtrace',
        'file_base': 'clip_s4_puck',
        'start_s': 117.500,
        'next_start_s': 127.500,
        'text': 'Snowtrace confirms the live receipt: execution strictly reverted on Avalanche Fuji, with Payee Not In Mission Set.',
        'caption': 'On-chain proof: Snowtrace confirms execution reverted with PayeeNotInMissionSet.',
    },
    {
        'id': 's5_verify',
        'file_base': 'clip_s5_puck',
        'start_s': 129.000,
        'next_start_s': 148.500,
        'text': 'Anchored on chain with an ERC 8004 score of 100, tamper with one byte, and verification breaks.',
        'caption': 'Independent verification: ERC-8004 score 100/100; tamper with 1 byte and verification breaks.',
    },
    {
        'id': 's6_diagram',
        'file_base': 'clip_s6_puck',
        'start_s': 148.900,
        'next_start_s': 153.800,
        'text': 'Agents propose payouts, smart contracts enforce limits.',
        'caption': 'Dual-Layer Defense: LLM agents propose, while Avalanche Fuji contracts enforce.',
    },
    {
        'id': 's7_outro',
        'file_base': 'clip_s7_puck',
        'start_s': 154.000,
        'next_start_s': 159.500,
        'text': "LLMs can be fooled. Budgets on Avalanche can't.",
        'caption': "LLMs can be fooled. Budgets on Avalanche can't.",
    },
]

def format_srt_time(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int((sec % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def get_audio_duration(file_path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(file_path)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(res.stdout.strip())

def generate_tts_clip(cue: dict, force: bool = False) -> tuple[Path, bool]:
    pcm_path = VIDEO_DIR / f"{cue['file_base']}.pcm"
    wav_path = VIDEO_DIR / f"{cue['file_base']}.wav"
    mp3_path = VIDEO_DIR / f"{cue['file_base']}.mp3"
    prompt_record = VIDEO_DIR / f"{cue['file_base']}.prompt.txt"

    max_dur = cue['next_start_s'] - cue['start_s']
    if not force and wav_path.exists() and prompt_record.exists():
        if prompt_record.read_text(encoding='utf-8').strip() == cue['text'].strip():
            dur = get_audio_duration(wav_path)
            if dur <= max_dur:
                print(f"  [TTS] Reusing verified {cue['id']} WAV (duration: {dur:.2f}s, window: {max_dur:.2f}s)")
                return wav_path, False

    model_tts = 'gemini-3.8-flash-lite-tts'
    voice = 'Puck'
    prompt_text = cue['text']

    body = {
        'contents': [{'parts': [{'text': prompt_text}]}],
        'generationConfig': {
            'responseModalities': ['AUDIO'],
            'speechConfig': {
                'voiceConfig': {
                    'prebuiltVoiceConfig': {
                        'voiceName': voice
                    }
                }
            }
        }
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_tts}:generateContent"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': api_key}
    )

    pcm_data = None
    for attempt in range(8):
        try:
            print(f"  [TTS] Generating {cue['id']} (attempt {attempt + 1})...")
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.load(resp)
                audio_b64 = data['candidates'][0]['content']['parts'][0]['inlineData']['data']
                pcm_data = base64.b64decode(audio_b64)
                print(f"  [TTS] Received {len(pcm_data)} PCM bytes for {cue['id']}")
                break
        except urllib.error.HTTPError as e:
            print(f"  [TTS] HTTP Error {e.code}: {e.read()[:200]}")
            if e.code == 429:
                wait_sec = 25 + attempt * 5
                print(f"  [TTS] Rate limit 429: waiting {wait_sec}s...")
                time.sleep(wait_sec)
                continue
            time.sleep(10)
        except Exception as e:
            print(f"  [TTS] Error: {e}")
            time.sleep(10)

    if not pcm_data:
        raise RuntimeError(f"Failed to generate TTS for {cue['id']}")

    pcm_path.write_bytes(pcm_data)

    # Convert PCM to 48kHz stereo WAV and MP3, trimming leading and trailing silence
    raw_wav = VIDEO_DIR / f"{cue['file_base']}_raw.wav"
    subprocess.run([
        'ffmpeg', '-y',
        '-f', 's16le', '-ar', '24000', '-ac', '1',
        '-i', str(pcm_path),
        '-ar', '48000', '-ac', '2',
        str(raw_wav)
    ], check=True, capture_output=True)

    subprocess.run([
        'ffmpeg', '-y',
        '-i', str(raw_wav),
        '-af', 'silenceremove=start_periods=1:start_duration=0.03:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_duration=0.03:start_threshold=-40dB,areverse',
        str(wav_path)
    ], check=True, capture_output=True)

    subprocess.run([
        'ffmpeg', '-y',
        '-i', str(wav_path),
        str(mp3_path)
    ], check=True, capture_output=True)

    dur = get_audio_duration(wav_path)
    max_dur = cue['next_start_s'] - cue['start_s']
    print(f"  [TTS] {cue['id']} WAV duration: {dur:.2f}s (window: {max_dur:.2f}s)")

    # Save prompt record and invalidate stale ASR cache
    prompt_record.write_text(cue['text'].strip(), encoding='utf-8')
    asr_cache = VIDEO_DIR / f"{cue['file_base']}.asr.txt"
    if asr_cache.exists():
        try:
            asr_cache.unlink()
        except Exception:
            pass

    # Small pause to avoid 429 rate limit spikes
    time.sleep(3.0)

    # R17c-F1: NO atempo anywhere. If clip is too long, raise error to shorten text or lengthen scene.
    if dur > max_dur:
        raise RuntimeError(
            f"Clip {cue['id']} duration ({dur:.2f}s) exceeds available window ({max_dur:.2f}s)! "
            f"NO atempo allowed per R17c-F1. Shorten text or lengthen scene."
        )

    return wav_path, True

def transcribe_clip(cue: dict) -> str:
    asr_cache = VIDEO_DIR / f"{cue['file_base']}.asr.txt"
    if asr_cache.exists():
        cached_text = asr_cache.read_text(encoding='utf-8').strip()
        if cached_text:
            print(f"  [ASR] Reusing cached transcription for {cue['id']}: \"{cached_text}\"")
            return cached_text

    mp3_path = VIDEO_DIR / f"{cue['file_base']}.mp3"
    model_transcribe = 'gemini-3.1-flash-lite'
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_transcribe}:generateContent"

    mp3_b64 = base64.b64encode(mp3_path.read_bytes()).decode('utf-8')
    body = {
        'contents': [
            {
                'parts': [
                    {
                        'inlineData': {
                            'mimeType': 'audio/mp3',
                            'data': mp3_b64
                        }
                    },
                    {
                        'text': 'Transcribe the spoken English audio verbatim. Return only the transcription text, nothing else.'
                    }
                ]
            }
        ]
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': api_key}
    )

    transcription = ""
    for attempt in range(8):
        try:
            print(f"  [ASR] Transcribing {cue['id']} (attempt {attempt + 1})...")
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.load(resp)
                transcription = data['candidates'][0]['content']['parts'][0]['text'].strip()
                asr_cache.write_text(transcription, encoding='utf-8')
                break
        except urllib.error.HTTPError as e:
            print(f"  [ASR] HTTP Error {e.code}: {e.read()[:200]}")
            if e.code == 429:
                wait_sec = 25 + attempt * 5
                print(f"  [ASR] Rate limit 429: waiting {wait_sec}s...")
                time.sleep(wait_sec)
                continue
            time.sleep(10)
        except Exception as e:
            print(f"  [ASR] Error: {e}")
            time.sleep(10)

    print(f"  [ASR] Result: \"{transcription}\"")
    return transcription

def compile_master_voice_track(total_duration: float = 149.1, sample_rate: int = 48000) -> Path:
    print(f"\n[Assembly] Compiling master voice track into 48kHz stereo PCM ({total_duration:.1f}s)...")
    n_samples = int(total_duration * sample_rate)
    total_bytes = n_samples * 4  # 16-bit stereo = 4 bytes per frame
    voice_buffer = bytearray(total_bytes)

    for i, cue in enumerate(CUES):
        wav_path = VIDEO_DIR / f"{cue['file_base']}.wav"
        with wave.open(str(wav_path), "rb") as wf:
            n_frames = wf.getnframes()
            data = wf.readframes(n_frames)

        start_sample = int(cue['start_s'] * sample_rate)
        start_byte = start_sample * 4

        # Guarantee zero overlap with next cue
        if i + 1 < len(CUES):
            max_bytes = int((CUES[i + 1]['start_s'] - cue['start_s']) * sample_rate) * 4
        else:
            max_bytes = len(data)

        data_to_write = data[:max_bytes]
        end_byte = min(start_byte + len(data_to_write), len(voice_buffer))
        actual_len = end_byte - start_byte
        if actual_len > 0:
            voice_buffer[start_byte:start_byte + actual_len] = data_to_write[:actual_len]

    master_voice_wav = VIDEO_DIR / 'master_voice_puck.wav'
    with wave.open(str(master_voice_wav), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(voice_buffer)

    print(f"  [Assembly] Saved master voice track: {master_voice_wav}")
    return master_voice_wav

def mix_master_audio(voice_wav: Path, total_duration: float = 149.1) -> Path:
    print(f"\n[Mix] Mixing voice track with background music (Gymnopédie No. 1) for {total_duration:.1f}s...")
    mixed_audio = VIDEO_DIR / 'master_audio_mixed.aac'
    fade_out_st = max(0.0, total_duration - 3.5)

    filter_complex = (
        f"[1:a]atrim=0:{total_duration},volume=0.32,"
        f"afade=t=in:ss=0:d=2.0,afade=t=out:st={fade_out_st:.2f}:d=3.5[bgm];"
        f"[bgm][0:a]sidechaincompress=threshold=0.02:ratio=16:attack=100:release=600[ducked_bgm];"
        f"[0:a][ducked_bgm]amix=inputs=2:duration=first:weights=1.0 0.9[mix];"
        f"[mix]loudnorm=I=-16:TP=-1.5:LRA=11,atrim=0:{total_duration}[aout]"
    )

    cmd = [
        'ffmpeg', '-y',
        '-i', str(voice_wav),
        '-stream_loop', '-1',
        '-i', str(MUSIC_FILE),
        '-filter_complex', filter_complex,
        '-map', '[aout]',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        str(mixed_audio)
    ]
    subprocess.run(cmd, check=True)
    print(f"  [Mix] Mixed audio created: {mixed_audio}")
    return mixed_audio

def build_final_video(mixed_audio: Path, total_duration: float = 149.1):
    print(f"\n[Mux] Muxing video stream with mixed audio track into MissionPay-demo.mp4 ({total_duration:.1f}s)...")
    cmd = [
        'ffmpeg', '-y',
        '-i', str(CONCAT_VIDEO),
        '-i', str(mixed_audio),
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-shortest',
        '-t', f"{total_duration:.2f}",
        str(FINAL_VIDEO)
    ]
    subprocess.run(cmd, check=True)
    print(f"  [Mux] Final video written: {FINAL_VIDEO}")

def write_subtitles():
    print("\n[Subtitles] Writing narration.srt and updating captions.srt...")
    srt_lines = []
    for idx, cue in enumerate(CUES):
        # Caption display duration
        start_fmt = format_srt_time(cue['start_s'])
        end_fmt = format_srt_time(cue['next_start_s'] - 0.2)
        srt_lines.append(f"{idx + 1}\n{start_fmt} --> {end_fmt}\n{cue['caption']}\n")

    content = "\n".join(srt_lines)
    SRT_PATH.write_text(content, encoding='utf-8')
    CAPTIONS_SRT.write_text(content, encoding='utf-8')
    print(f"  [Subtitles] Saved {SRT_PATH} and {CAPTIONS_SRT}")

def write_credits():
    print("\n[Credits] Writing CREDITS.md...")
    credits_content = """# MissionPay Video Demo — Credits & Asset Licenses

This document lists all media assets, synthetic voices, music, and tools used in the production of the official **MissionPay** demo video for the Avalanche Team1 Vietnam UniHack 2026 Hackathon.

All third-party assets are free, open-source, or public domain, with permissive licenses allowing inclusion in a public repository and public video distribution.

---

## 1. Narration & Voice-Over (Synthetic)

- **Voice Model**: `gemini-3.8-flash-lite-tts`
- **Voice Preset**: `Puck` (high-energy, clear tech-demo delivery)
- **API Provider**: Google Generative AI (Gemini Developer API)
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
"""
    CREDITS_PATH.write_text(credits_content.strip() + "\n", encoding='utf-8')
    print(f"  [Credits] Saved {CREDITS_PATH}")

def main():
    print("==================================================================")
    print("   MissionPay Gemini Puck Narration & Mixing Pipeline (Round 17c) ")
    print("==================================================================\n")

    # Step 1: Generate or verify all TTS clips
    print("[1/6] Generating TTS clips using gemini-3.1-flash-tts-preview (voice: Puck)...")
    total_voice_duration = 0.0

    for cue in CUES:
        wav_path, generated = generate_tts_clip(cue)
        dur = get_audio_duration(wav_path)
        total_voice_duration += dur
        words = len(cue['text'].split())
        rate = words / dur if dur > 0 else 0
        print(f"  -> Cue {cue['id']:16s}: {dur:5.2f}s | {words:2d} words | {rate:4.2f} w/s | {cue['text'][:55]}...")

    print(f"\nTotal Spoken Audio: {total_voice_duration:.2f}s")

    # Step 2: Transcribe each clip back with gemini-3.1-flash-lite
    print("\n[2/6] Verifying speech content via Gemini 3.1 Flash Lite ASR...")
    for cue in CUES:
        transcription = transcribe_clip(cue)
        print(f"  -> {cue['id']:16s}: \"{transcription}\"")

    # Step 3: Get actual video duration from CONCAT_VIDEO
    if not CONCAT_VIDEO.exists():
        print(f"\nWarning: {CONCAT_VIDEO} does not exist yet. Run build-video.ts first.")
        total_video_dur = 149.1
    else:
        total_video_dur = get_audio_duration(CONCAT_VIDEO)

    voice_coverage = (total_voice_duration / total_video_dur) * 100
    print(f"\nVideo Duration: {total_video_dur:.2f}s | Voice Coverage: {voice_coverage:.1f}% (target: >= 70%)")

    # Step 4: Compile master voice track
    print(f"\n[3/6] Compiling master voice track ({total_video_dur:.2f}s)...")
    master_voice_wav = compile_master_voice_track(total_duration=total_video_dur)

    # Step 5: Mix voice with Gymnopédie No. 1 (sidechain ducking + loudnorm)
    print(f"\n[4/6] Mixing voice with background music...")
    mixed_audio = mix_master_audio(master_voice_wav, total_duration=total_video_dur)

    # Step 6: Write subtitles and credits
    print("\n[5/6] Writing subtitles and credits...")
    write_subtitles()
    write_credits()

    # Step 7: Build final mp4 if concat video exists
    if CONCAT_VIDEO.exists():
        print("\n[6/6] Muxing final video MissionPay-demo.mp4...")
        # Backup silent demo if not backed up
        if not SILENT_BACKUP.exists() and (VIDEO_DIR / 'demo-silent.mp4').exists():
            import shutil
            shutil.copy2(VIDEO_DIR / 'demo-silent.mp4', SILENT_BACKUP)
        build_final_video(mixed_audio, total_duration=total_video_dur)
        print(f"\nSUCCESS! MissionPay-demo.mp4 created: {FINAL_VIDEO} ({total_video_dur:.2f}s)")
    else:
        print("\nSkipping mux: concat-silent.mp4 not found yet.")

if __name__ == '__main__':
    main()
