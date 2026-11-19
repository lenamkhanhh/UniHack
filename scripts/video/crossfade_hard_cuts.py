import cv2
import numpy as np
import subprocess
import os

import cv2
import numpy as np
import subprocess
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

VIDEO_IN = os.path.join(ROOT, "artifacts", "submission-s1", "video", "MissionPay-demo.mp4")
VIDEO_TMP = os.path.join(ROOT, "artifacts", "submission-s1", "video", "temp_smooth.mp4")
VIDEO_OUT = os.path.join(ROOT, "artifacts", "submission-s1", "video", "MissionPay-demo.mp4")
AUDIO_TMP = os.path.join(ROOT, "artifacts", "submission-s1", "video", "temp_audio.aac")

print(f"Opening {VIDEO_IN}...")
cap = cv2.VideoCapture(VIDEO_IN)
fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
print(f"Video info: {width}x{height} @ {fps} fps, total {total_frames} frames ({total_frames/fps:.2f}s)")

# 1. First extract audio to keep it bit-for-bit identical
print("Extracting original audio track...")
subprocess.run(
    f'ffmpeg -y -i "{VIDEO_IN}" -vn -c:a copy "{AUDIO_TMP}"',
    shell=True,
    check=True,
    capture_output=True
)

# 2. Known cut frame indices from ffmpeg scene analysis:
# 18.00s -> 540
# 39.60s -> 1188
# 42.533s -> 1276
# 129.90s -> 3897
# 132.067s -> 3962
cut_indices = [540, 1188, 1276, 3897, 3962]
print(f"Target hard cut frame indices: {cut_indices}")

# Crossfade half-window K = 8 (total 17 frames = ~567ms, right in 400-600ms spec)
K = 8

# Pre-load anchor frames around cuts
# For each cut Fc, we need:
# - last frame of Scene A: frame Fc - 1
# - first frame of Scene B: frame Fc
anchors = {}
for fc in cut_indices:
    cap.set(cv2.CAP_PROP_POS_FRAMES, fc - 1)
    ret_a, frame_a = cap.read()
    ret_b, frame_b = cap.read()
    if ret_a and ret_b:
        anchors[fc] = (frame_a.astype(np.float32), frame_b.astype(np.float32))
        print(f"Captured anchors for cut Fc={fc} ({fc/fps:.2f}s): A={fc-1}, B={fc}")
    else:
        print(f"Warning: Failed to capture anchors for Fc={fc}")

# 3. Read video sequentially and write through ffmpeg pipe
cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

ffmpeg_cmd = [
    'ffmpeg', '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-s', f'{width}x{height}',
    '-pix_fmt', 'bgr24',
    '-r', str(fps),
    '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23.5',
    '-pix_fmt', 'yuv420p',
    VIDEO_TMP
]

print("Encoding smooth video via ffmpeg pipe...")
proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

f_idx = 0
while True:
    ret, frame = cap.read()
    if not ret:
        break
    
    # Check if f_idx falls into any crossfade window [fc - K, fc + K]
    matched_fc = None
    for fc in cut_indices:
        if fc - K <= f_idx <= fc + K:
            matched_fc = fc
            break
            
    if matched_fc is None or matched_fc not in anchors:
        # Untouched original frame
        proc.stdin.write(frame.tobytes())
    else:
        fc = matched_fc
        frame_a_anchor, frame_b_anchor = anchors[fc]
        
        # Determine image_a and image_b
        # If f_idx < fc: image_a is current frame, image_b is B anchor
        # If f_idx >= fc: image_a is A anchor, image_b is current frame
        cur_float = frame.astype(np.float32)
        if f_idx < fc:
            img_a = cur_float
            img_b = frame_b_anchor
        else:
            img_a = frame_a_anchor
            img_b = cur_float
            
        # Cosine easing alpha from 0 to 1 over [fc - K, fc + K]
        t = (f_idx - (fc - K)) / (2 * K)
        alpha = 0.5 * (1.0 - np.cos(np.pi * t))
        
        blended = ((1.0 - alpha) * img_a + alpha * img_b).astype(np.uint8)
        proc.stdin.write(blended.tobytes())
        
    f_idx += 1
    if f_idx % 500 == 0:
        print(f"  Processed {f_idx}/{total_frames} frames ({f_idx/total_frames*100:.1f}%)...")

cap.release()
proc.stdin.close()
proc.wait()
print(f"Video stream completed. Processed {f_idx} frames.")

# 4. Remux with original audio
print("Remuxing smooth video with original audio...")
FINAL_TEMP = os.path.join(ROOT, "artifacts", "submission-s1", "video", "MissionPay-demo-r19.mp4")
subprocess.run(
    f'ffmpeg -y -i "{VIDEO_TMP}" -i "{AUDIO_TMP}" -c:v copy -c:a copy "{FINAL_TEMP}"',
    shell=True,
    check=True
)

# Overwrite final output
if os.path.exists(VIDEO_OUT):
    os.remove(VIDEO_OUT)
os.rename(FINAL_TEMP, VIDEO_OUT)

# Clean up temp files
if os.path.exists(VIDEO_TMP):
    os.remove(VIDEO_TMP)
if os.path.exists(AUDIO_TMP):
    os.remove(AUDIO_TMP)

print(f"SUCCESS: {VIDEO_OUT} updated with cross-faded cuts!")
