"""配乐与音效：搜索下载（Mixkit 可商用免署名库）、节拍与爆发点分析、逐小节能量表。

python3 scripts/music.py search music cinematic trailer technology    按标签/分类列曲目（标题 id 时长）
python3 scripts/music.py search sfx whoosh impact riser typing          按分类列音效
python3 scripts/music.py get music 726 614 -o /tmp/music                下载曲目
python3 scripts/music.py get sfx 790 2531 -o audio-src                  下载音效
python3 scripts/music.py analyze /tmp/music/*.mp3                       时长、BPM、每秒响度曲线、爆发点猜测
python3 scripts/music.py grid audio-src/music.mp3                       精确节拍周期 + 爆发点处的强拍
python3 scripts/music.py bars audio-src/music.mp3 --beat 0.8955 --downbeat 14.38 --offset 2.88
                                                                        逐小节能量表，并换算成视频时间轴
python3 scripts/music.py tempo audio-src/music.mp3 --from 8 --to 46     grid 一致性 < 0.8 时用：频谱通量自相关测 BPM，
                                                                        并列出逐 2 秒的重拍，供人工确认小节线
"""
import argparse
import os
import re
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy.signal import butter, find_peaks, sosfilt

SR = 22050
UA = {"User-Agent": "Mozilla/5.0"}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8", "ignore")


def parse_cards(html):
    out = []
    for b in re.split(r'<div[^>]*class="item-grid-card[ "]', html)[1:]:
        t = re.search(r'item-grid-card__title">\s*([^<]+?)\s*<', b)
        u = re.search(r"https://assets\.mixkit\.co/(?:music/(\d+)/\d+\.mp3|active_storage/sfx/(\d+)/)", b)
        d = re.search(r'duration">\s*([\d:]+)', b)
        if t and u:
            out.append((t.group(1), u.group(1) or u.group(2), d.group(1) if d else ""))
    return out


def search(kind, terms):
    for term in terms:
        if kind == "music":
            paths = [f"free-stock-music/tag/{term}/", f"free-stock-music/{term}/"] if "/" not in term else [term]
        else:
            paths = [f"free-sound-effects/{term}/"] if "/" not in term else [term]
        cards = []
        for p in paths:
            try:
                cards = parse_cards(fetch(f"https://mixkit.co/{p}"))
            except Exception:
                cards = []
            if cards:
                break
        print(f"== {term} ({len(cards)})")
        for title, i, dur in cards:
            print(f"  {i:>6}  {dur:>5}  {title}")


def get(kind, ids, out):
    os.makedirs(out, exist_ok=True)

    def one(i):
        url = f"https://assets.mixkit.co/music/{i}/{i}.mp3" if kind == "music" else f"https://assets.mixkit.co/active_storage/sfx/{i}/{i}-preview.mp3"
        dest = os.path.join(out, f"{i}.mp3")
        subprocess.run(["curl", "-sL", "-A", UA["User-Agent"], "-o", dest, url])
        return dest

    with ThreadPoolExecutor(16) as ex:
        for dest in ex.map(one, ids):
            print(dest, f"{duration(dest):.2f}s")


def load(path, sr=SR):
    raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def bpm(x):
    hop = 512
    e = np.array([np.sum(x[i * hop : (i + 1) * hop] ** 2) for i in range(len(x) // hop)])
    onset = np.maximum(0, np.diff(np.log(e + 1e-9)))
    onset -= onset.mean()
    ac = np.correlate(onset, onset, mode="full")[len(onset) - 1 :]
    fr = SR / hop
    lo, hi = int(fr * 60 / 180), int(fr * 60 / 70)
    return 60 * fr / (lo + np.argmax(ac[lo:hi]))


def drop_guess(x):
    sec = np.array([np.sqrt(np.mean(x[i * SR : (i + 1) * SR] ** 2)) for i in range(len(x) // SR)])
    if len(sec) < 6:
        return None
    rise = [(20 * np.log10((sec[i : i + 3].mean() + 1e-9) / (sec[max(0, i - 3) : i].mean() + 1e-9)), i) for i in range(3, len(sec) - 3)]
    return max(rise)


def analyze(files):
    for f in files:
        x = load(f)
        dur = len(x) / SR
        sec = [float(np.sqrt(np.mean(x[i * SR : (i + 1) * SR] ** 2))) for i in range(int(dur))]
        mx = max(sec) or 1
        curve = "".join(" .:-=+*#%@"[min(9, int(v / mx * 9.99))] for v in sec)
        dg = drop_guess(x)
        drop = f"drop≈{dg[1]}s(+{dg[0]:.1f}dB)" if dg else ""
        print(f"{os.path.basename(f):>14} {dur:6.1f}s bpm≈{bpm(x):5.1f} {drop:>18}  {curve}")


def kick_times(x, a, b):
    lo = np.abs(sosfilt(butter(4, 150, "low", fs=SR, output="sos"), x))
    hop = 64
    env = np.array([lo[i : i + hop].mean() for i in range(0, len(lo) - hop, hop)])
    fr = SR / hop
    s = env[int(a * fr) : int(b * fr)]
    pk, _ = find_peaks(s, height=s.max() * 0.55, distance=int(0.25 * fr))
    return pk / fr + a


def grid(path, a=None, b=None):
    x = load(path)
    dur = len(x) / SR
    dg = drop_guess(x)
    a = a if a is not None else max(0, (dg[1] if dg else 0) - 1)
    b = b if b is not None else min(dur, a + 30)
    t = kick_times(x, a, b)
    if len(t) < 4:
        raise SystemExit("强拍太少，换个 --from/--to 区间")
    best = max((np.mean(np.cos(2 * np.pi * (((t - t[0]) / p) % 1))), p) for p in np.arange(0.25, 1.2, 0.0001))
    beat = best[1]
    print(f"强拍（{a:.1f}–{b:.1f}s）：{np.round(t[:16], 3)}")
    print(f"节拍周期 beat = {beat:.4f}s  （{60 / beat:.1f} BPM，倍速 {120 / beat:.1f}）  一致性 {best[0]:.2f}")
    print(f"一小节(4 拍) bar = {4 * beat:.4f}s   两小节 = {8 * beat:.4f}s")
    print(f"爆发点附近第一个强拍 downbeat = {t[0]:.3f}s")
    print("把视频爆发点放在 T 秒时：musicOffset = downbeat - T；timing.json 里 beat/bar 用上面的值")


def tempo(path, a, b):
    """预告片 / 混合配器的作曲重拍多、切分多，grid 的强拍拟合常给出倍速或一致性很低。这里用频谱通量自相关找周期。"""
    x = load(path)
    a = a or 0.0
    b = b or len(x) / SR
    hop = 256
    fr = SR / hop
    w = np.hanning(1024)
    S = np.abs(np.array([np.fft.rfft(x[i : i + 1024] * w) for i in range(0, len(x) - 1024, hop)]))
    flux = np.maximum(0, np.diff(np.log1p(S), axis=0)).sum(1)
    f = flux[int(a * fr) : int(b * fr)]
    f = f - f.mean()
    ac = np.correlate(f, f, "full")[len(f) - 1 :]
    lags = np.arange(len(ac)) / fr
    m = (lags > 0.35) & (lags < 0.8)
    beat = lags[np.argmax(ac * m)]
    print(f"节拍周期 beat = {beat:.4f}s（{60 / beat:.2f} BPM），一小节 bar = {4 * beat:.4f}s")
    lo = sosfilt(butter(4, 120, "low", fs=SR, output="sos"), x)
    h2 = 110
    db = 20 * np.log10(np.array([np.sqrt(np.mean(lo[i : i + h2] ** 2)) for i in range(0, len(lo) - h2, h2)]) + 1e-7)
    on = np.convolve(np.maximum(0, np.diff(db, prepend=db[0])), np.ones(3), "same")
    pk, _ = find_peaks(on, height=4, distance=int(0.2 * SR / h2))
    ts = pk * h2 / SR
    print("每 2 秒内最强的低频起音（找小节线用，前后几格应间隔一致）：")
    for t0 in np.arange(0, len(x) / SR, 2.0):
        sel = pk[(ts >= t0) & (ts < t0 + 2)]
        if len(sel):
            print(f"  {t0:5.1f}–{t0 + 2:5.1f}s  {sel[np.argmax(on[sel])] * h2 / SR:6.2f}s")


def bars(path, beat, downbeat, offset):
    x = load(path)
    lo = sosfilt(butter(4, 150, "low", fs=SR, output="sos"), x)
    hi = sosfilt(butter(4, 4000, "high", fs=SR, output="sos"), x)
    bar = 4 * beat
    t = downbeat - int(downbeat // bar) * bar

    def db(y, s):
        return 20 * np.log10(np.sqrt(np.mean(y[s] ** 2)) + 1e-9)

    print(f"{'曲目时间':>8} {'视频时间':>8} {'全频':>6} {'低频':>6} {'高频':>6}")
    while t + bar <= len(x) / SR:
        s = slice(int(t * SR), int((t + bar) * SR))
        v = db(x, s)
        print(f"{t:8.2f} {t - offset:8.2f} {v:6.1f} {db(lo, s):6.1f} {db(hi, s):6.1f} " + "#" * int(max(0, 40 + 2 * v)))
        t += bar


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest="cmd", required=True)
p = sub.add_parser("search"); p.add_argument("kind", choices=["music", "sfx"]); p.add_argument("terms", nargs="+")
p = sub.add_parser("get"); p.add_argument("kind", choices=["music", "sfx"]); p.add_argument("ids", nargs="+"); p.add_argument("-o", default=".")
p = sub.add_parser("analyze"); p.add_argument("files", nargs="+")
p = sub.add_parser("grid"); p.add_argument("file"); p.add_argument("--from", dest="a", type=float); p.add_argument("--to", dest="b", type=float)
p = sub.add_parser("tempo"); p.add_argument("file"); p.add_argument("--from", dest="a", type=float); p.add_argument("--to", dest="b", type=float)
p = sub.add_parser("bars"); p.add_argument("file"); p.add_argument("--beat", type=float, required=True); p.add_argument("--downbeat", type=float, required=True); p.add_argument("--offset", type=float, default=0)
a = ap.parse_args()

if a.cmd == "search":
    search(a.kind, a.terms)
elif a.cmd == "get":
    get(a.kind, a.ids, a.o)
elif a.cmd == "analyze":
    analyze(a.files)
elif a.cmd == "grid":
    grid(a.file, a.a, a.b)
elif a.cmd == "tempo":
    tempo(a.file, a.a, a.b)
elif a.cmd == "bars":
    bars(a.file, a.beat, a.downbeat, a.offset)
else:
    sys.exit(1)
