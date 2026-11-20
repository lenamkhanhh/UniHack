#!/usr/bin/env python3
"""Compose one scene: manifest (frame -> screenshot + camera box) -> lossless 30 fps CFR intermediate.

Each output frame is a sub-pixel-exact Lanczos resize of a 2x screenshot (box = camera rectangle, float),
so a fixed camera gives the same 1920x950 pixels every frame, and the single eased zoom has no rounding jumps.
Identical (shot, box) pairs are computed once and the same bytes are written again (pixel-exact stillness).
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

manifest_file, out_file = sys.argv[1], sys.argv[2]
m = json.loads(Path(manifest_file).read_text(encoding="utf-8"))
W, H, D, FPS = m["w"], m["h"], m["dsf"], m["fps"]
shot_dir = Path(m["shotDir"])

ff = subprocess.Popen(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
     "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-framerate", str(FPS), "-i", "-",
     "-c:v", "libx264", "-qp", "0", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", str(FPS), out_file],
    stdin=subprocess.PIPE,
)
cur_shot, cur_img = -1, None
last_key, last_bytes = None, b""
for shot, x0, y0, w, h in m["frames"]:
    key = (shot, x0, y0, w, h)
    if key != last_key:
        if shot != cur_shot:
            cur_img = Image.open(shot_dir / f"{shot}.jpg").convert("RGB")
            cur_shot = shot
        box = (x0 * D, y0 * D, (x0 + w) * D, (y0 + h) * D)
        if abs(w - W) < 1e-6 and abs(h - H) < 1e-6 and x0 == 0 and y0 == 0:
            frame = cur_img.resize((W, H), Image.LANCZOS)
        else:
            frame = cur_img.resize((W, H), Image.LANCZOS, box=box)
        last_bytes = frame.tobytes()
        last_key = key
    ff.stdin.write(last_bytes)
ff.stdin.close()
if ff.wait() != 0:
    sys.exit("ffmpeg failed")
