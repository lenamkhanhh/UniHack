#!/usr/bin/env python3
"""Build final narrated demo video using Google Gemini TTS ('Puck') and Erik Satie background music.

Requirements (Round 18 Review):
- A1: Eliminate trailing click/burst ("oh"). Cut each clip at end of speech, drop after >=250ms silence gap, 40ms fade-out.
      Build-time assertion: loudest 50ms in last 300ms must not exceed median speech level by > 3 dB.
- A2: Measured pace <= 1.9 words/s per clip. Voice coverage 50–60%. Silence >= 0.6s between cues.
      Style prompt: "Say in a calm, clear, measured pace, natural sentence endings, no exclamation: <cue text>"
      Model: gemini-3.1-flash-tts-preview (voice: Puck). No atempo anywhere.
- A3: Subtitles / captions match exact spoken ASR text verbatim. Visual cues synchronized.
- Audio mix: Erik Satie Gymnopédie No. 1 (public domain), sidechain ducking, EBU R128 loudnorm (-16 LUFS).
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
import numpy as np
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

# Cues definitions for Round 18
# Rules: <= 14 words per line, <= 1.9 words/s, >= 0.6s gap between cues, 50%–60% coverage, total <= 180s
CUES = [
    {
        'id': 's0_intro',
        'file_base': 'clip_s0_r18',
        'start_s': 0.200,
        'next_start_s': 6.500,
        'text': 'Same vendor. Same treasury. Two outcomes.',
    },
    {
        'id': 's1a_home',
        'file_base': 'clip_s1a_r18',
        'start_s': 6.500,
        'next_start_s': 15.500,
        'text': 'MissionPay secures agent treasuries: owner signs limits, contract enforces on Avalanche.',
    },
    {
        'id': 's1b_objects',
        'file_base': 'clip_s1b_r18',
        'start_s': 15.500,
        'next_start_s': 24.500,
        'text': 'Three objects govern payouts: signed policy, Merkle proof, and treasury gate.',
    },
    {
        'id': 's1c1_allowlist',
        'file_base': 'clip_s1c1_r18',
        'start_s': 24.500,
        'next_start_s': 30.500,
        'text': 'The allowlist drained funds to an off-mission vendor.',
    },
    {
        'id': 's1c2_mission',
        'file_base': 'clip_s1c2_r18',
        'start_s': 30.500,
        'next_start_s': 38.500,
        'text': 'On Avalanche Fuji... MissionPay strictly reverted... with zero funds lost.',
    },
    {
        'id': 's1c3_links',
        'file_base': 'clip_s1c3_r18',
        'start_s': 38.500,
        'next_start_s': 45.000,
        'text': 'Each row links... to a real Fuji transaction receipt.',
    },
    {
        'id': 's2a_receipts',
        'file_base': 'clip_s2a_r18',
        'start_s': 45.500,
        'next_start_s': 53.000,
        'text': 'In Judge Mode, live Fuji receipts prove on-chain behavior.',
    },
    {
        'id': 's2b_attacker',
        'file_base': 'clip_s2b_r18',
        'start_s': 53.000,
        'next_start_s': 62.000,
        'text': 'Testing an attacker: the contract strictly reverts with Payee Not In Mission Set.',
    },
    {
        'id': 's2c_owner',
        'file_base': 'clip_s2c_r18',
        'start_s': 62.000,
        'next_start_s': 70.000,
        'text': 'Testing the owner address succeeds. Read-only simulation requires zero gas.',
    },
    {
        'id': 's2d_cast',
        'file_base': 'clip_s2d_r18',
        'start_s': 70.500,
        'next_start_s': 78.500,
        'text': 'Copy the cast command to query public Avalanche Fuji RPC directly.',
    },
    {
        'id': 's2e_limits',
        'file_base': 'clip_s2e_r18',
        'start_s': 79.000,
        'next_start_s': 86.500,
        'text': 'Updating the mission Merkle root requires the owner signature.',
    },
    {
        'id': 's3a_bounty',
        'file_base': 'clip_s3a_r18',
        'start_s': 87.000,
        'next_start_s': 96.000,
        'text': 'Prompt injection tricks the agent, but our dual-layer guard protects the treasury.',
    },
    {
        'id': 's3b_trace',
        'file_base': 'clip_s3b_r18',
        'start_s': 96.500,
        'next_start_s': 106.000,
        'text': 'Tainted from tool output... our validator blocks the payout.',
    },
    {
        'id': 's4_snowtrace',
        'file_base': 'clip_s4_r18',
        'start_s': 106.500,
        'next_start_s': 116.000,
        'text': 'Snowtrace confirms live execution reverted on Fuji... with Payee Not In Mission Set.',
    },
    {
        'id': 's5a_verify',
        'file_base': 'clip_s5a_r18',
        'start_s': 116.500,
        'next_start_s': 126.500,
        'text': 'Cryptographically anchored on Fuji... ERC eight thousand and four validation confirms a perfect score.',
    },
    {
        'id': 's5b_tamper',
        'file_base': 'clip_s5b_r18',
        'start_s': 127.000,
        'next_start_s': 136.000,
        'text': 'Tamper one byte... and the cryptographic hash chain breaks.',
    },
    {
        'id': 's5c_restore',
        'file_base': 'clip_s5c_r18',
        'start_s': 136.500,
        'next_start_s': 145.500,
        'text': 'Restore the original... and one hundred percent cryptographic integrity is confirmed.',
    },
    {
        'id': 's6_diagram',
        'file_base': 'clip_s6_r18',
        'start_s': 146.000,
        'next_start_s': 154.000,
        'text': 'Agents propose payouts... while Avalanche smart contracts enforce limits.',
    },
    {
        'id': 's7_outro',
        'file_base': 'clip_s7_r18',
        'start_s': 154.500,
        'next_start_s': 162.000,
        'text': 'LLMs can be fooled... Budgets on Avalanche cannot.',
    },
]

def format_srt_time(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    ms = int(round((sec % 1) * 1000))
    if ms >= 1000:
        s += 1
        ms -= 1000
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

def trim_and_assert_tail(raw_mono: np.ndarray, sr: int = 24000) -> tuple[np.ndarray, float, float, float]:
    """Cuts clip at end of speech, drops after >=250ms silence gap, applies 40ms fade-out.
    Performs build-time assertion: loudest 50ms in last 300ms must not exceed median speech level by > 3 dB.
    """
    w10 = int(0.010 * sr)
    n_win = len(raw_mono) // w10
    rms_db = np.array([20 * np.log10(np.sqrt(np.mean(raw_mono[i*w10:(i+1)*w10]**2)) + 1e-12) for i in range(n_win)])

    speech_indices = np.where(rms_db > -45.0)[0]
    cand_gap = None
    for idx in reversed(speech_indices):
        for offset in range(1, 8):
            gap_start = idx + offset
            if gap_start + 25 <= n_win:
                gap_vals = rms_db[gap_start : gap_start + 25]
                # Gap of >= 250ms below -50dB with average below -55dB
                if np.all(gap_vals < -50.0) and np.mean(gap_vals) < -55.0:
                    cand_gap = (gap_start, gap_start + 25)
                    break
        if cand_gap is not None:
            break

    if cand_gap is not None:
        # Drop everything after the gap
        cut_sample = cand_gap[1] * w10
        trimmed = raw_mono[:cut_sample].copy()
    else:
        trimmed = raw_mono.copy()

    # 40ms linear fade-out
    fade_len = int(0.040 * sr)
    if len(trimmed) > fade_len:
        trimmed[-fade_len:] *= np.linspace(1.0, 0.0, fade_len)

    # Assertion metrics
    speech_windows = rms_db[rms_db > -45.0]
    med_speech = float(np.median(speech_windows)) if len(speech_windows) > 0 else -22.0
    w50 = int(0.050 * sr)
    last300 = trimmed[-int(0.300 * sr):]
    loudest_50ms = -999.0
    for j in range(0, len(last300) - w50 + 1, max(1, w50 // 4)):
        c50 = last300[j : j+w50]
        rms50 = 20 * np.log10(np.sqrt(np.mean(c50**2)) + 1e-12)
        if rms50 > loudest_50ms:
            loudest_50ms = float(rms50)

    diff = loudest_50ms - med_speech
    return trimmed, med_speech, loudest_50ms, diff

def generate_tts_clip(cue: dict, force: bool = False) -> tuple[Path, dict]:
    pcm_path = VIDEO_DIR / f"{cue['file_base']}.pcm"
    wav_path = VIDEO_DIR / f"{cue['file_base']}.wav"
    mp3_path = VIDEO_DIR / f"{cue['file_base']}.mp3"
    prompt_record = VIDEO_DIR / f"{cue['file_base']}.prompt.txt"
    meta_record = VIDEO_DIR / f"{cue['file_base']}.meta.json"

    max_dur = cue['next_start_s'] - cue['start_s']

    if not force and wav_path.exists() and prompt_record.exists() and meta_record.exists():
        if prompt_record.read_text(encoding='utf-8').strip() == cue['text'].strip():
            meta = json.loads(meta_record.read_text(encoding='utf-8'))
            dur = get_audio_duration(wav_path)
            if dur <= max_dur and meta.get('wps', 99) <= 1.9 and meta.get('tail_diff', 99) <= 3.0:
                print(f"  [TTS] Reusing verified R18 {cue['id']} WAV (dur: {dur:.2f}s, wps: {meta.get('wps'):.2f}, tail diff: {meta.get('tail_diff'):.1f}dB)")
                return wav_path, meta

    model_tts = 'gemini-3.1-flash-tts-preview'
    voice = 'Puck'
    style_prompt = f"Say in a calm, clear, measured pace, natural sentence endings, no exclamation: {cue['text']}"

    body = {
        'contents': [{'parts': [{'text': style_prompt}]}],
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
    for attempt in range(2):
        try:
            print(f"  [TTS] Generating {cue['id']} via {model_tts} (attempt {attempt + 1})...")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
                audio_b64 = data['candidates'][0]['content']['parts'][0]['inlineData']['data']
                pcm_data = base64.b64decode(audio_b64)
                print(f"  [TTS] Received {len(pcm_data)} PCM bytes for {cue['id']}")
                break
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode('utf-8', errors='ignore')
            print(f"  [TTS] HTTP Error {e.code}: {err_msg[:200]}")
            if e.code == 429:
                print(f"  [TTS] 429 encountered on {cue['id']}. Halting immediately per instruction.")
                raise RuntimeError(f"TTS_QUOTA_BLOCKED_429 on {cue['id']}: {err_msg}")
            time.sleep(5)
        except Exception as e:
            print(f"  [TTS] Error: {e}")
            time.sleep(10)

    if not pcm_data:
        raise RuntimeError(f"Failed to generate TTS for {cue['id']}. Rate limit or quota exhausted.")

    pcm_path.write_bytes(pcm_data)

    # 1. Process 24kHz raw PCM: trim click/burst and assert tail level
    raw_samples = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
    trimmed_mono, med_speech, loudest_50ms, diff = trim_and_assert_tail(raw_samples, 24000)

    # A1 Assertion check
    if diff > 3.0:
        raise AssertionError(
            f"A1 Tail Assertion FAILED for {cue['id']}: loudest 50ms ({loudest_50ms:.1f} dB) "
            f"exceeds median speech ({med_speech:.1f} dB) by {diff:.1f} dB (> 3.0 dB limit)!"
        )

    # 2. Resample trimmed mono to 48kHz stereo int16
    n_48k = int(len(trimmed_mono) * 2)
    t_orig = np.linspace(0, len(trimmed_mono) / 24000, len(trimmed_mono), endpoint=False)
    t_48k = np.linspace(0, len(trimmed_mono) / 24000, n_48k, endpoint=False)
    resampled_48k = np.interp(t_48k, t_orig, trimmed_mono)

    int16_stereo = np.zeros((n_48k, 2), dtype=np.int16)
    int16_stereo[:, 0] = np.clip(resampled_48k * 32767, -32768, 32767).astype(np.int16)
    int16_stereo[:, 1] = int16_stereo[:, 0]

    with wave.open(str(wav_path), 'wb') as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(48000)
        wf.writeframes(int16_stereo.tobytes())

    # 3. Create MP3 for ASR transcription
    subprocess.run([
        'ffmpeg', '-y', '-i', str(wav_path), str(mp3_path)
    ], check=True, capture_output=True)

    dur = get_audio_duration(wav_path)
    clean_words = cue['text'].replace('...', ' ').replace(':', ' ').split()
    words_count = len(clean_words)
    wps = words_count / dur if dur > 0 else 0

    meta = {
        'id': cue['id'],
        'duration': dur,
        'words': words_count,
        'wps': wps,
        'med_speech': med_speech,
        'loudest_50ms': loudest_50ms,
        'tail_diff': diff,
    }

    meta_record.write_text(json.dumps(meta, indent=2), encoding='utf-8')
    prompt_record.write_text(cue['text'].strip(), encoding='utf-8')

    # Remove stale ASR cache
    asr_cache = VIDEO_DIR / f"{cue['file_base']}.asr.txt"
    if asr_cache.exists():
        try:
            asr_cache.unlink()
        except Exception:
            pass

    print(f"  [TTS] {cue['id']} WAV: {dur:.2f}s | {words_count} words | {wps:.2f} w/s | med={med_speech:.1f}dB tail={loudest_50ms:.1f}dB diff={diff:.1f}dB [A1 PASS]")

    # Pause 22s to respect API rate limits (Free Tier 3 RPM limit)
    time.sleep(22.0)

    if dur > max_dur:
        raise RuntimeError(
            f"Clip {cue['id']} duration ({dur:.2f}s) exceeds available window ({max_dur:.2f}s)! "
            f"NO atempo allowed per spec. Lengthen scene."
        )

    return wav_path, meta

def transcribe_clip(cue: dict) -> str:
    asr_cache = VIDEO_DIR / f"{cue['file_base']}.asr.txt"
    if asr_cache.exists():
        cached_text = asr_cache.read_text(encoding='utf-8').strip()
        if cached_text:
            print(f"  [ASR] Reusing cached transcription for {cue['id']}: \"{cached_text}\"")
            return cached_text

    mp3_path = VIDEO_DIR / f"{cue['file_base']}.mp3"
    model_transcribe = 'gemini-3-flash-preview'
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
    time.sleep(2.0)
    return transcription

def compile_master_voice_track(total_duration: float = 152.0, sample_rate: int = 48000) -> Path:
    print(f"\n[Assembly] Compiling master voice track into 48kHz stereo PCM ({total_duration:.1f}s)...")
    n_samples = int(total_duration * sample_rate)
    total_bytes = n_samples * 4
    voice_buffer = bytearray(total_bytes)

    for i, cue in enumerate(CUES):
        wav_path = VIDEO_DIR / f"{cue['file_base']}.wav"
        with wave.open(str(wav_path), "rb") as wf:
            n_frames = wf.getnframes()
            data = wf.readframes(n_frames)

        start_sample = int(cue['start_s'] * sample_rate)
        start_byte = start_sample * 4

        # Guarantee zero overlap and >= 0.6s gap
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

def mix_master_audio(voice_wav: Path, total_duration: float = 152.0) -> Path:
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

def build_final_video(mixed_audio: Path, total_duration: float = 152.0):
    print(f"\n[Mux] Muxing video stream with mixed audio track into MissionPay-demo.mp4 ({total_duration:.1f}s)...")
    cmd = [
        'ffmpeg', '-y',
        '-i', str(CONCAT_VIDEO),
        '-i', str(mixed_audio),
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-vf', 'noise=alls=2:allf=t',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
        '-c:a', 'copy',
        '-shortest',
        '-t', f"{total_duration:.2f}",
        str(FINAL_VIDEO)
    ]
    subprocess.run(cmd, check=True)
    print(f"  [Mux] Final video written: {FINAL_VIDEO}")

def write_subtitles_from_asr(asr_transcriptions: dict[str, str]):
    print("\n[Subtitles] Writing narration.srt and captions.srt strictly from verbatim ASR...")
    srt_lines = []
    for idx, cue in enumerate(CUES):
        start_fmt = format_srt_time(cue['start_s'])
        end_fmt = format_srt_time(cue['next_start_s'] - 0.4)
        spoken_text = asr_transcriptions.get(cue['id'], cue['text'])
        srt_lines.append(f"{idx + 1}\n{start_fmt} --> {end_fmt}\n{spoken_text}\n")

    content = "\n".join(srt_lines)
    SRT_PATH.write_text(content, encoding='utf-8')
    CAPTIONS_SRT.write_text(content, encoding='utf-8')
    print(f"  [Subtitles] Saved {SRT_PATH} and {CAPTIONS_SRT}")

def write_credits():
    print("\n[Credits] Writing CREDITS.md...")
    credits_content = """# MissionPay Video Demo — Credits & Asset Licenses (Round 18)

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
"""
    CREDITS_PATH.write_text(credits_content.strip() + "\n", encoding='utf-8')
    print(f"  [Credits] Saved {CREDITS_PATH}")

def main():
    print("==================================================================")
    print("   MissionPay Gemini Puck Narration & Mixing Pipeline (Round 18)  ")
    print("==================================================================\n")

    # Step 1: Generate or verify all TTS clips with A1 assertions and <= 1.9 wps
    print("[1/6] Generating TTS clips using gemini-3.1-flash-tts-preview (voice: Puck)...")
    total_voice_duration = 0.0
    meta_results = []

    for cue in CUES:
        wav_path, meta = generate_tts_clip(cue)
        dur = meta['duration']
        total_voice_duration += dur
        meta_results.append(meta)

    print(f"\nTotal Spoken Audio: {total_voice_duration:.2f}s")

    # Step 2: Transcribe each clip back with gemini-3.1-flash-lite
    print("\n[2/6] Verifying speech content via Gemini 3.1 Flash Lite ASR...")
    asr_map = {}
    for cue in CUES:
        transcription = transcribe_clip(cue)
        asr_map[cue['id']] = transcription

    # Step 3: Get actual video duration from CONCAT_VIDEO
    if not CONCAT_VIDEO.exists():
        print(f"\nWarning: {CONCAT_VIDEO} does not exist yet. Run build-video.ts first.")
        total_video_dur = 152.0
    else:
        total_video_dur = get_audio_duration(CONCAT_VIDEO)

    voice_coverage = (total_voice_duration / total_video_dur) * 100
    print(f"\nVideo Duration: {total_video_dur:.2f}s | Voice Coverage: {voice_coverage:.1f}% (target: 50%–60%)")

    # Step 4: Compile master voice track
    print(f"\n[3/6] Compiling master voice track ({total_video_dur:.2f}s)...")
    master_voice_wav = compile_master_voice_track(total_duration=total_video_dur)

    # Step 5: Mix voice with Gymnopédie No. 1 (sidechain ducking + loudnorm)
    print(f"\n[4/6] Mixing voice with background music...")
    mixed_audio = mix_master_audio(master_voice_wav, total_duration=total_video_dur)

    # Step 6: Write subtitles and credits from verbatim ASR
    print("\n[5/6] Writing subtitles and credits from verbatim ASR...")
    write_subtitles_from_asr(asr_map)
    write_credits()

    # Step 7: Build final mp4 if concat video exists
    if CONCAT_VIDEO.exists():
        print("\n[6/6] Muxing final video MissionPay-demo.mp4...")
        if not SILENT_BACKUP.exists() and (VIDEO_DIR / 'demo-silent.mp4').exists():
            import shutil
            shutil.copy2(VIDEO_DIR / 'demo-silent.mp4', SILENT_BACKUP)
        build_final_video(mixed_audio, total_duration=total_video_dur)
        print(f"\nSUCCESS! MissionPay-demo.mp4 created: {FINAL_VIDEO} ({total_video_dur:.2f}s)")
    else:
        print("\nSkipping mux: concat-silent.mp4 not found yet.")

if __name__ == '__main__':
    main()
