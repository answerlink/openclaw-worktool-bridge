"""联系表、抽帧图上标注文字用的中文字体：按 macOS / Windows / Linux 的常见位置依次找，找不到就用 Pillow 默认字体（中文会显示成方框）。"""
import glob

from PIL import ImageFont

CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/usr/share/fonts/**/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/**/wqy-microhei.ttc",
]


def label_font(size):
    for pattern in CANDIDATES:
        for path in glob.glob(pattern, recursive=True):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()
