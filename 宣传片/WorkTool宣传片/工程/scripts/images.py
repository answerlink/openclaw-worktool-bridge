"""图片素材：从产品文档批量抓图、按文档出联系表挑图、按画幅预览裁切效果、缩放进 public/。

python3 scripts/images.py grab <md文件或目录...> [--match 关键词 ...] -o /tmp/imgs
    抓取 Markdown 里的全部图片（跳过 gif），按文档分组命名 <组号>_<序号>，写 index.txt（组号→文档标题）
python3 scripts/images.py sheet /tmp/imgs [--group ab12c] [--minw 700]
    每个文档一张带文件名和尺寸的联系表 /tmp/imgs/_sheet_<组号>.jpg，用来逐篇挑图
python3 scripts/images.py crop out/pick.jpg /tmp/imgs/a_01.png /tmp/imgs/b_03.png [--ratio 16:9] [--anchor top]
    按视频里的实际裁切方式预览候选图，决定用哪张、objectPosition 设哪里
python3 scripts/images.py prepare <源图> <public 下的目标路径> [--max 2800]
    统一转 jpg 并限制宽度（4K 渲染下同屏大图很多时，按实际显示尺寸再缩小，避免解码失败）
python3 scripts/images.py info public/works
    列出尺寸，标出过小（放大会糊）和过大（4K 渲染吃内存）的图
"""
import argparse
import glob
import hashlib
import os
import re
import subprocess
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from labelfont import label_font
from PIL import Image, ImageDraw, ImageOps

FONT = label_font(14)


def md_files(paths, match):
    out = []
    for p in paths:
        out += glob.glob(os.path.join(p, "**", "*.md"), recursive=True) if os.path.isdir(p) else [p]
    return sorted(f for f in out if not match or any(k in f for k in match))


def grab(paths, match, out):
    os.makedirs(out, exist_ok=True)
    jobs, index = [], []
    for f in md_files(paths, match):
        title = os.path.splitext(os.path.basename(f))[0]
        group = hashlib.md5(f.encode()).hexdigest()[:5]
        index.append(f"{group}\t{title}\t{f}")
        txt = open(f, encoding="utf-8").read()
        urls = re.findall(r"!\[[^\]]*\]\((https?://[^)\s]+)\)", txt) + re.findall(r'<img[^>]+src="(https?://[^"]+)"', txt)
        for i, u in enumerate(urls):
            ext = os.path.splitext(urllib.parse.urlparse(u).path)[1].lower() or ".png"
            if ext != ".gif":
                jobs.append((u, os.path.join(out, f"{group}_{i:02d}{ext}")))
    open(os.path.join(out, "index.txt"), "w", encoding="utf-8").write("\n".join(index))

    def dl(j):
        u, p = j
        if not (os.path.exists(p) and os.path.getsize(p) > 1000):
            subprocess.run(["curl", "-sL", "--max-time", "30", "-A", "Mozilla/5.0", "-o", p, u])

    with ThreadPoolExecutor(32) as ex:
        list(ex.map(dl, jobs))
    print(f"{len(jobs)} 张图，来自 {len(index)} 篇文档 -> {out}（组号见 index.txt）")


def open_rgb(path):
    im = Image.open(path)
    im.load()
    return im.convert("RGB")


def sheet(folder, group, minw):
    groups = [group] if group else sorted({os.path.basename(f).split("_")[0] for f in glob.glob(os.path.join(folder, "*_*.*")) if not os.path.basename(f).startswith("_")})
    titles = {}
    idx = os.path.join(folder, "index.txt")
    if os.path.exists(idx):
        for line in open(idx, encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2:
                titles[parts[0]] = parts[1]
    for g in groups:
        items = []
        for f in sorted(glob.glob(os.path.join(folder, f"{g}_*"))):
            try:
                im = open_rgb(f)
            except Exception:
                continue
            if im.width >= minw:
                items.append((f, im))
        if not items:
            continue
        W, H, cols = 400, 250, 6
        rows = (len(items) + cols - 1) // cols
        s = Image.new("RGB", (W * cols, rows * (H + 20) + 30), "#111")
        d = ImageDraw.Draw(s)
        d.text((8, 6), f"{g}  {titles.get(g, '')}", fill="#fff", font=FONT)
        for i, (f, im) in enumerate(items):
            size = im.size
            im.thumbnail((W, H))
            x, y = (i % cols) * W, 30 + (i // cols) * (H + 20)
            s.paste(im, (x, y))
            d.text((x + 3, y + H + 2), f"{os.path.basename(f)} {size[0]}x{size[1]}", fill="#ff0", font=FONT)
        dest = os.path.join(folder, f"_sheet_{g}.jpg")
        s.save(dest, quality=80)
        print(dest, len(items), titles.get(g, ""))


def crop(out, files, ratio, anchor):
    rw, rh = (float(v) for v in ratio.split(":"))
    W = 640
    H = round(W * rh / rw)
    cy = {"top": 0.0, "center": 0.5, "bottom": 1.0}[anchor]
    cols = 3
    rows = (len(files) + cols - 1) // cols
    s = Image.new("RGB", (W * cols, rows * (H + 22)), "#111")
    d = ImageDraw.Draw(s)
    for i, f in enumerate(files):
        im = ImageOps.fit(open_rgb(f), (W, H), centering=(0.5, cy))
        x, y = (i % cols) * W, (i // cols) * (H + 22)
        s.paste(im, (x, y))
        d.text((x + 4, y + H + 4), os.path.basename(f), fill="#ff0", font=FONT)
    s.save(out, quality=85)
    print(out)


def prepare(src, dst, max_w):
    im = open_rgb(src)
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    im.save(dst, quality=90)
    print(dst, im.size)


def info(folder):
    for f in sorted(glob.glob(os.path.join(folder, "**", "*.*"), recursive=True)):
        try:
            w, h = Image.open(f).size
        except Exception:
            continue
        flag = "  ⚠ 过小，放大必糊" if max(w, h) < 1000 else ("  ⚠ 过大，4K 同屏多张时先缩小" if w > 3000 else "")
        print(f"{w:5d}x{h:<5d} {os.path.relpath(f, folder)}{flag}")


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest="cmd", required=True)
p = sub.add_parser("grab"); p.add_argument("paths", nargs="+"); p.add_argument("--match", nargs="*"); p.add_argument("-o", required=True)
p = sub.add_parser("sheet"); p.add_argument("folder"); p.add_argument("--group"); p.add_argument("--minw", type=int, default=700)
p = sub.add_parser("crop"); p.add_argument("out"); p.add_argument("files", nargs="+"); p.add_argument("--ratio", default="16:9"); p.add_argument("--anchor", default="top", choices=["top", "center", "bottom"])
p = sub.add_parser("prepare"); p.add_argument("src"); p.add_argument("dst"); p.add_argument("--max", type=int, default=2800)
p = sub.add_parser("info"); p.add_argument("folder")
a = ap.parse_args()

{"grab": lambda: grab(a.paths, a.match, a.o), "sheet": lambda: sheet(a.folder, a.group, a.minw),
 "crop": lambda: crop(a.out, a.files, a.ratio, a.anchor), "prepare": lambda: prepare(a.src, a.dst, a.max),
 "info": lambda: info(a.folder)}[a.cmd]()
