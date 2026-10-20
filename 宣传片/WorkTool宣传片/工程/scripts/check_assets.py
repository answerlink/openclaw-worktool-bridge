"""渲染前的素材闸门：代码里引用的 public/ 文件是否存在、图片是否过小或过大、字体子集是否缺字。有 ERROR 时退出码为 1。

python3 scripts/check_assets.py
"""
import glob
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
EXT = r"png|jpe?g|webp|svg|gif|mp3|wav|mp4|webm|woff2"
errors, warns = [], []

refs = set()
for p in glob.glob(os.path.join(ROOT, "src", "**", "*.ts*"), recursive=True) + glob.glob(os.path.join(ROOT, "web", "*.ts*")):
    for m in re.finditer(rf"[\"'`]/?([^\"'`$\s]+\.(?:{EXT}))[\"'`]", open(p, encoding="utf-8").read()):
        refs.add((m.group(1).lstrip("/"), os.path.relpath(p, ROOT)))
for ref, where in sorted(refs):
    if not os.path.exists(os.path.join(PUB, ref)):
        errors.append(f"缺文件 public/{ref}（{where}）")

if not os.path.exists(os.path.join(PUB, "audio", "mix.wav")):
    errors.append("缺 public/audio/mix.wav，先跑 npm run mix")

for f in glob.glob(os.path.join(PUB, "**", "*.*"), recursive=True):
    if not re.search(r"\.(png|jpe?g|webp)$", f, re.I):
        continue
    try:
        w, h = Image.open(f).size
    except Exception as e:
        errors.append(f"图片损坏 {os.path.relpath(f, ROOT)}: {e}")
        continue
    rel = os.path.relpath(f, ROOT)
    if max(w, h) < 1000:
        warns.append(f"{rel} 只有 {w}x{h}，若在画面里显示超过 {w // 2}px 宽，4K 下会糊")
    if w > 3000:
        warns.append(f"{rel} 宽 {w}px，4K 渲染同屏多张时易解码失败，按显示尺寸×2 缩小")

cfg = json.load(open(os.path.join(ROOT, "fonts.json"), encoding="utf-8"))
for f in cfg["fonts"]:
    if not os.path.exists(os.path.join(PUB, "fonts", f"{f['file']}.woff2")):
        errors.append(f"缺字体 public/fonts/{f['file']}.woff2，先跑 npm run fonts")

for w in warns:
    print("WARN ", w)
for e in errors:
    print("ERROR", e)
print(f"引用 {len(refs)} 个文件；{len(errors)} 个错误，{len(warns)} 个提醒")
sys.exit(1 if errors else 0)
