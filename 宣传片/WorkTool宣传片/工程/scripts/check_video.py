"""成片闸门：规格、渲染日志报错、响度、按场景抽帧联系表。有 ERROR 时退出码为 1。

python3 scripts/check_video.py out/final-4k.mp4 [--log out/render.log] [--scale 2]
抽帧联系表写到 out/check_<文件名>.jpg，必须打开看一遍。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

from labelfont import label_font
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("--log", default=os.path.join(ROOT, "out", "render.log"))
ap.add_argument("--scale", type=float, default=None, help="渲染时的 --scale，用来核对分辨率")
a = ap.parse_args()

tm = json.load(open(os.path.join(ROOT, "src", "timing.json"), encoding="utf-8"))
errors, notes = [], []

probe = json.loads(subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration", "-of", "json", a.video],
    capture_output=True, text=True).stdout)
v = next((s for s in probe["streams"] if s["codec_type"] == "video"), None)
au = next((s for s in probe["streams"] if s["codec_type"] == "audio"), None)
dur = float(probe["format"]["duration"])
if not v:
    raise SystemExit("ERROR 没有视频流")
notes.append(f"视频 {v['codec_name']} {v['width']}x{v['height']} @ {v['r_frame_rate']}，时长 {dur:.2f}s，音频 {au['codec_name'] if au else '无'}")
if not au:
    errors.append("成片没有音轨")
if abs(dur - tm["duration"]) > 0.2:
    errors.append(f"时长 {dur:.2f}s 与 timing.json 的 {tm['duration']}s 不符")
if a.scale and (v["width"], v["height"]) != (round(tm["width"] * a.scale), round(tm["height"] * a.scale)):
    errors.append(f"分辨率 {v['width']}x{v['height']} 不是预期的 {tm['width'] * a.scale:.0f}x{tm['height'] * a.scale:.0f}")

if os.path.exists(a.log):
    log = open(a.log, encoding="utf-8", errors="ignore").read()
    bad = re.findall(r".*(?:cannot be decoded|Error:|error:|failed to load|Timeout).*", log)
    if bad:
        errors.append(f"渲染日志有 {len(bad)} 条报错，例如：{bad[0].strip()[:160]}")
    else:
        notes.append("渲染日志无报错")
else:
    notes.append(f"没找到渲染日志 {a.log}，跳过日志检查")

if au:
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", a.video, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", err)
    pk = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)
    if i:
        lufs = float(i[-1])
        notes.append(f"响度 {lufs} LUFS，真峰值 {pk[-1] if pk else '?'} dBFS")
        if not -16.5 <= lufs <= -12.5:
            errors.append(f"响度 {lufs} LUFS 偏离 -14 太多")

times = []
for name, (s, e) in tm["scenes"].items():
    times.append((name, s + (e - s) * 0.6))
tmp = tempfile.mkdtemp()
W = 480
H = round(W * v["height"] / v["width"])
cols = 4
rows = (len(times) + cols - 1) // cols
sheet = Image.new("RGB", (W * cols, rows * (H + 22)), "#111")
draw = ImageDraw.Draw(sheet)
font = label_font(15)
for k, (name, t) in enumerate(times):
    p = os.path.join(tmp, f"{k}.jpg")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", a.video, "-frames:v", "1", "-vf", f"scale={W}:-1", p])
    if os.path.exists(p):
        x, y = (k % cols) * W, (k // cols) * (H + 22)
        sheet.paste(Image.open(p), (x, y))
        draw.text((x + 4, y + H + 3), f"{t:.1f}s {name}", fill="#ffd54a", font=font)
dest = os.path.join(ROOT, "out", f"check_{os.path.splitext(os.path.basename(a.video))[0]}.jpg")
os.makedirs(os.path.dirname(dest), exist_ok=True)
sheet.save(dest, quality=85)
notes.append(f"抽帧联系表：{dest}")

for n in notes:
    print("OK   ", n)
for e in errors:
    print("ERROR", e)
sys.exit(1 if errors else 0)
