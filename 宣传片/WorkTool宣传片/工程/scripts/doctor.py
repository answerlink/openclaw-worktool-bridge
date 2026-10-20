"""环境体检：第一次使用、换电脑、或者脚本报奇怪的错时先跑一遍。只检查，不安装任何东西。

python3 <工具目录>/template/scripts/doctor.py   在工作区根目录跑（还没建项目时）
python3 scripts/doctor.py                      在 <输出目录>/<项目>/工程/ 下跑（会多检查 node_modules）

MISSING 是必需项，缺了做不出片子；WARN 是可选项，缺了只影响对应的功能。
"""
import importlib.util
import json
import os
import platform
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
MAC, WIN = platform.system() == "Darwin", platform.system() == "Windows"
rows = []


def report(level, name, detail, fix=""):
    rows.append(level)
    pad = 18 - sum(2 if ord(c) > 0x2E80 else 1 for c in name)
    print(f"{level:8s}{name}{' ' * pad}{detail}" + (f"\n{'':26s}→ {fix}" if fix else ""))


def install_hint(mac, win, linux):
    return mac if MAC else win if WIN else linux


def version(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip().splitlines()[0]
    except (OSError, IndexError, subprocess.TimeoutExpired):
        return ""


v = version(["node", "-v"])
major = int(re.sub(r"\D", "", v.split(".")[0]) or 0) if v else 0
if major >= 18:
    report("OK", "Node.js", v)
else:
    report("MISSING", "Node.js", v or "没装", "装 Node.js 18 以上：https://nodejs.org")

for tool in ("ffmpeg", "ffprobe"):
    if shutil.which(tool):
        report("OK", tool, version([tool, "-version"])[:60])
    else:
        report("MISSING", tool, "没装", install_hint("brew install ffmpeg", "winget install ffmpeg", "sudo apt install ffmpeg"))

if sys.version_info >= (3, 9):
    report("OK", "Python", platform.python_version())
else:
    report("MISSING", "Python", platform.python_version(), "需要 Python 3.9 以上")

missing = [m for m, mod in [("numpy", "numpy"), ("scipy", "scipy"), ("Pillow", "PIL"), ("fonttools", "fontTools"), ("brotli", "brotli")] if not importlib.util.find_spec(mod)]
if missing:
    report("MISSING", "Python 依赖", "缺 " + " ".join(missing), f"pip install -r {os.path.relpath(os.path.join(ROOT, 'requirements.txt'))}")
else:
    report("OK", "Python 依赖", "numpy scipy Pillow fonttools brotli")

if importlib.util.find_spec("playwright"):
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            exe = p.chromium.executable_path
        if os.path.exists(exe):
            report("OK", "Playwright", "截 4K 页面图可用（scripts/shot.py）")
        else:
            report("WARN", "Playwright", "没装浏览器内核", "playwright install chromium")
    except Exception as e:  # noqa: BLE001
        report("WARN", "Playwright", f"启动失败：{e}"[:80], "playwright install chromium")
else:
    report("WARN", "Playwright", "没装，不能用 shot.py / snapshot.py 截页面图", "pip install playwright && playwright install chromium")

if os.path.isdir(os.path.join(ROOT, "node_modules")):
    report("OK", "npm 依赖", "已安装")
elif os.path.basename(ROOT) == "template":
    report("OK", "npm 依赖", "建项目后在 工程/ 里 npm install（不要在 template 里装）")
else:
    report("MISSING", "npm 依赖", "没装", "npm install")

try:
    from fonts import resolve

    cfg = json.load(open(os.path.join(ROOT, "fonts.json"), encoding="utf-8"))
    bad = [f["file"] for f in cfg["fonts"] if not resolve(f["source"])]
    if bad:
        report("MISSING", "中文字体", f"找不到 {', '.join(bad)}", "把字体文件放进 fonts-src/ 并改 fonts.json；Linux 可 sudo apt install fonts-noto-cjk")
    else:
        report("OK", "中文字体", ", ".join(os.path.basename(resolve(f["source"])[0]) for f in cfg["fonts"]))
except Exception as e:  # noqa: BLE001
    report("WARN", "中文字体", f"检查失败：{e}"[:80])

from elevenlabs import env_files  # noqa: E402

env = os.environ.get("ELEVENLABS_API_KEY") and "环境变量"
for f in env_files():
    if not env and os.path.exists(f) and "ELEVENLABS_API_KEY=" in open(f, encoding="utf-8").read():
        env = f
if env:
    report("OK", "ElevenLabs", f"已配置 key（{env}）；额度用 python3 scripts/elevenlabs.py quota 查")
else:
    report("WARN", "ElevenLabs", "没配置：不能生成旁白和定制配乐，会改用曲库配乐 + 纯字幕", "需要时把 ELEVENLABS_API_KEY=... 写进工作区根目录的 .env，或设成环境变量")

print()
if "MISSING" in rows:
    print(f"有 {rows.count('MISSING')} 项必需环境没装好，装好后再跑一次。")
    sys.exit(1)
print("必需环境都齐了。" + ("" if MAC else "本工具主要在 macOS 上打磨，其他系统遇到问题请对照 references/踩坑记录.md。"))
