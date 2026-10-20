"""按 fonts.json 把字体子集化成 public/fonts/*.woff2（只保留 src/ 和 web/ 里实际用到的字）。改文案后重跑。

source 写法：
  system:PingFang#3            系统字体（在 macOS / Windows / Linux 的字体目录里找 .ttc/.ttf/.otf），# 后是 TTC 内的序号
  fonts-src/xxx.ttf            工程内字体文件
  fonts-src/xxx.ttc#2          工程内 TTC 的第 2 个字重
  A|B|C                        依次尝试，用第一个找得到的（模板默认：苹方 → 微软雅黑 → Noto Sans CJK）
"""
import glob
import json
import logging
import os
import string

from fontTools import subset
from fontTools.ttLib import TTFont

logging.getLogger("fontTools").setLevel(logging.ERROR)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "fonts")

SYSTEM_DIRS = [
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "/Library/Fonts",
    os.path.expanduser("~/Library/Fonts"),
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font*/*/AssetData",
    "C:/Windows/Fonts",
    os.path.expandvars("%LOCALAPPDATA%/Microsoft/Windows/Fonts"),
    "/usr/share/fonts/**",
    "/usr/local/share/fonts/**",
    os.path.expanduser("~/.local/share/fonts/**"),
    os.path.expanduser("~/.fonts/**"),
]


def resolve_one(source):
    path, _, index = source.partition("#")
    index = int(index or 0)
    if path.startswith("system:"):
        name = path[len("system:"):]
        for d in SYSTEM_DIRS:
            for ext in ("ttc", "ttf", "otf"):
                hits = glob.glob(os.path.join(d, f"{name}.{ext}"), recursive=True)
                if hits:
                    return hits[0], index
        return None
    full = os.path.join(ROOT, path)
    return (full, index) if os.path.exists(full) else None


def resolve(source):
    for alt in source.split("|"):
        hit = resolve_one(alt.strip())
        if hit:
            return hit
    return None


def used_chars(cfg):
    chars = set(string.printable) | set(cfg.get("extraChars", ""))
    for pattern in ["src/**/*.ts", "src/**/*.tsx", "src/**/*.json", "web/**/*.ts", "web/**/*.tsx", "web/*.html"]:
        for p in glob.glob(os.path.join(ROOT, pattern), recursive=True):
            chars |= set(open(p, encoding="utf-8").read())
    return "".join(sorted(c for c in chars if c.isprintable() or c == " "))


def main():
    cfg = json.load(open(os.path.join(ROOT, "fonts.json"), encoding="utf-8"))
    text = used_chars(cfg)
    os.makedirs(OUT, exist_ok=True)
    for f in cfg["fonts"]:
        hit = resolve(f["source"])
        if not hit:
            raise SystemExit(f"找不到字体 {f['source']}：把字体文件放进 fonts-src/ 并改 fonts.json（免费可商用字体见 references/素材获取.md）")
        path, index = hit
        font = TTFont(path, fontNumber=index)
        missing = [c for c in text if ord(c) > 0x2E80 and ord(c) not in font.getBestCmap()]
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["*"]
        opts.name_IDs = ["*"]
        opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        sub.populate(text=text)
        sub.subset(font)
        dest = os.path.join(OUT, f"{f['file']}.woff2")
        font.flavor = "woff2"
        font.save(dest)
        note = f"  ⚠ 缺字 {len(missing)} 个：{''.join(missing[:30])}" if missing else ""
        print(f"{f['file']}: {os.path.basename(path)} {len(text)} chars -> {os.path.getsize(dest) // 1024} KB{note}")


if __name__ == "__main__":
    main()
