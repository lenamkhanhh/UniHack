#!/usr/bin/env python3
"""Assemble the final MissionPay demo from frame-stepped scene renders + the 19 Puck r18 voice clips.

Timeline: scene i has length L_i (= clip + LEAD + TAIL); consecutive scenes overlap by XF seconds in an xfade
cross-fade, so scene i starts at S_i = sum(L_j, j<i) - i*XF and its voice clip starts at S_i + LEAD.
Nothing is time-stretched: no atempo, no setpts on the footage.

Usage: python scripts/video/assemble-video.py --scenes <dir> [--suffix _pv] [--out <file>] [--no-captions]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VIDEO = ROOT / "artifacts/submission-s1/video"
ORDER = ["s0", "s1a", "s1b", "s1c1", "s1c2", "s1c3", "s2a", "s2b", "s2c", "s2d", "s2e",
         "s3a", "s3b", "s4", "s5a", "s5b", "s5c", "s6", "s7"]
LEAD = 0.8
XF = 0.5

ap = argparse.ArgumentParser()
ap.add_argument("--scenes", required=True)
ap.add_argument("--suffix", default="")
ap.add_argument("--out", default=str(VIDEO / "MissionPay-demo.mp4"))
ap.add_argument("--no-captions", action="store_true")
ap.add_argument("--no-music", action="store_true")
args = ap.parse_args()
scenes_dir = Path(args.scenes)


def probe_dur(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


vids = [scenes_dir / f"{sid}{args.suffix}.mp4" for sid in ORDER]
for v in vids:
    if not v.exists():
        sys.exit(f"missing scene render: {v}")
L = [probe_dur(v) for v in vids]
S = [sum(L[:i]) - i * XF for i in range(len(L))]
total = sum(L) - (len(L) - 1) * XF
print(f"scenes={len(L)} total={total:.2f}s")

wavs = [VIDEO / f"clip_{sid}_r18.wav" for sid in ORDER]
meta = [json.loads((VIDEO / f"clip_{sid}_r18.meta.json").read_text(encoding="utf-8")) for sid in ORDER]
asr = [(VIDEO / f"clip_{sid}_r18.asr.txt").read_text(encoding="utf-8").strip() for sid in ORDER]

# ---------- captions: exactly the ASR text of each clip, timed to the real speech window
def tc(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def wrap(text: str, width: int = 44) -> str:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    if len(lines) == 3:  # keep captions to two lines
        lines = [" ".join(lines[:2]), lines[2]]
    return "\n".join(lines)


srt = []
for i, sid in enumerate(ORDER):
    a = S[i] + LEAD
    b = a + meta[i]["duration"]
    srt.append(f"{i + 1}\n{tc(a)} --> {tc(b)}\n{wrap(asr[i])}\n")
srt_text = "\n".join(srt)
work = scenes_dir
(work / "captions_build.srt").write_text(srt_text, encoding="utf-8")

# ---------- voice track (clips placed at their absolute start; mono 24k -> stereo 48k)
cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
for w in wavs:
    cmd += ["-i", str(w)]
fc = []
for i in range(len(wavs)):
    ms = int(round((S[i] + LEAD) * 1000))
    fc.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{i}]")
fc.append("".join(f"[v{i}]" for i in range(len(wavs))) +
          f"amix=inputs={len(wavs)}:normalize=0:dropout_transition=0,apad=whole_dur={total:.3f}[voice]")
voice = work / "voice_build.wav"
cmd += ["-filter_complex", ";".join(fc), "-map", "[voice]", "-t", f"{total:.3f}", "-ar", "48000", str(voice)]
subprocess.run(cmd, check=True)
print("voice track ok")

# ---------- music bed with sidechain ducking, then loudnorm
mix = work / "audio_mix.m4a"
if args.no_music:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(voice),
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", str(mix)], check=True)
else:
    music = VIDEO / "gymnopedie_no1.ogg"
    fcm = (
        f"[0:a]asplit=2[vsc][vmix];"
        f"[1:a]aloop=loop=-1:size=2147483647,atrim=0:{total:.3f},volume=0.55,"
        f"afade=t=in:st=0:d=2,afade=t=out:st={total - 3.5:.3f}:d=3.5[mus];"
        f"[mus][vsc]sidechaincompress=threshold=0.02:ratio=9:attack=30:release=600:makeup=1[duck];"
        f"[duck][vmix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[out]"
    )
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(voice), "-i", str(music),
                    "-filter_complex", fcm, "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k",
                    str(mix)], check=True)
print("audio mix ok")

# ---------- video: xfade chain, then (optionally) burned-in captions, final encode
cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
for v in vids:
    cmd += ["-i", str(v)]
cmd += ["-i", str(mix)]
chain, prev = [], "[0:v]"
for i in range(1, len(vids)):
    off = S[i]
    nxt = f"[x{i}]"
    chain.append(f"{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}{nxt}")
    prev = nxt
final_label = prev
if not args.no_captions:
    # style: bold white text on a translucent dark box, bottom centre
    style = ("FontName=Arial,FontSize=11,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H99000000,"
             "BorderStyle=3,Outline=2,Shadow=0,MarginV=34,Alignment=2")
    srt_name = "captions_build.srt"
    chain.append(f"{final_label}subtitles={srt_name}:fontsdir=C\\\\:/Windows/Fonts:force_style='{style}'[vout]")
    final_label = "[vout]"
cmd += ["-filter_complex", ";".join(chain), "-map", final_label, "-map", f"{len(vids)}:a",
        "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-maxrate", "7M", "-bufsize", "14M", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "copy", "-movflags", "+faststart", "-t", f"{total:.3f}", args.out]
subprocess.run(cmd, check=True, cwd=str(work))
print("wrote", args.out)

# the shipped caption files
if args.out == str(VIDEO / "MissionPay-demo.mp4"):
    (VIDEO / "captions.srt").write_text(srt_text, encoding="utf-8")
    (VIDEO / "narration.srt").write_text(srt_text, encoding="utf-8")
json.dump({"scenes": ORDER, "len": L, "start": S, "total": total, "lead": LEAD, "xf": XF},
          open(work / "timeline.json", "w"), indent=1)
