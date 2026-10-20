"""把一组截图拼成带标签的对比图（标签含时间和所属场景）。

python3 scripts/sheet.py                       # out/stills/*.jpg -> out/sheet.jpg
python3 scripts/sheet.py --dir out/stills --cols 4 --out out/sheet.jpg --width 480
"""
import argparse
import glob
import json
import os

from labelfont import label_font
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--dir", default=os.path.join(ROOT, "out", "stills"))
ap.add_argument("--cols", type=int, default=4)
ap.add_argument("--width", type=int, default=480)
ap.add_argument("--out", default=os.path.join(ROOT, "out", "sheet.jpg"))
a = ap.parse_args()

scenes = json.load(open(os.path.join(ROOT, "src", "timing.json")))["scenes"]


def label(path):
    name = os.path.splitext(os.path.basename(path))[0]
    try:
        t = float(name)
    except ValueError:
        return name
    hit = next((k for k, (s, e) in scenes.items() if s <= t < e), "")
    return f"{t:.2f}s {hit}"


files = sorted(glob.glob(os.path.join(a.dir, "*.jpg")) + glob.glob(os.path.join(a.dir, "*.png")))
if not files:
    raise SystemExit(f"没有截图：{a.dir}")
first = Image.open(files[0])
w = a.width
h = round(w * first.height / first.width)
rows = (len(files) + a.cols - 1) // a.cols
sheet = Image.new("RGB", (a.cols * w, rows * (h + 24)), "#1a1a1a")
draw = ImageDraw.Draw(sheet)
font = label_font(15)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((w, h))
    x, y = (i % a.cols) * w, (i // a.cols) * (h + 24)
    sheet.paste(im, (x, y))
    draw.text((x + 6, y + h + 3), label(f), fill="#ffd54a", font=font)
sheet.save(a.out, quality=85)
print(a.out, len(files))
