"""离线混音库：素材放置、合成音效、音乐入场渐强、母带与响度标准化。mix.py 是按项目写的 cue sheet，只调用这里。"""
import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "audio-src")
SR = 48000
rng = np.random.default_rng(3)


def timing():
    return json.load(open(os.path.join(ROOT, "src", "timing.json"), encoding="utf-8"))


def src(name):
    return os.path.join(SRC, name)


def load(name):
    """任意音频 -> float32 立体声 48k。name 可以是 audio-src 下的文件名或绝对路径。"""
    path = name if os.path.isabs(name) else src(name)
    raw = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True,
    ).stdout
    if not raw:
        raise FileNotFoundError(path)
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def seg(clip, a, b):
    return clip[int(a * SR) : int(b * SR)]


def lp(x, hz):
    return sosfilt(butter(4, hz, "low", fs=SR, output="sos"), x, axis=0)


def hp(x, hz):
    return sosfilt(butter(4, hz, "high", fs=SR, output="sos"), x, axis=0)


def stereo(m):
    return np.stack([m, m], axis=1).astype(np.float32)


# ---------- 合成音效 ----------

def sub_boom(length=3.5, f0=62, f1=28, decay=1.6):
    """低频冲击（下潜正弦 + 噪声瞬态），用在爆发点和转场重拍。"""
    t = np.arange(int(length * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 5)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
    click = rng.normal(0, 1, len(t)) * np.exp(-t * 60) * 0.35
    return stereo(np.tanh((body + lp(click, 2500)) * 1.6) * 0.9)


def blip(freq=1800, length=0.09, gain=0.5):
    """UI 提示音，适合卡片/数字逐个出现。"""
    t = np.arange(int(length * SR)) / SR
    return stereo(np.sin(2 * np.pi * freq * t) * np.exp(-t * 55) * gain)


def flick(length=0.05, gain=0.3):
    """纸牌/卡片滑动的短促噪声。"""
    t = np.arange(int(length * SR)) / SR
    n = rng.normal(0, 1, len(t)) * np.exp(-t * 90)
    return stereo(lp(hp(n, 1800), 7000) * gain)


def room_tone(length, gain=0.012):
    """极轻的无音高环境底噪，填补纯音效段落的空白，不和任何调性冲突。"""
    return stereo(lp(hp(rng.normal(0, 1, int(length * SR)), 180), 1600) * gain)


def reverb(x, seconds=2.8, wet=0.35):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    irs = []
    for _ in range(2):
        ir = lp(rng.normal(0, 1, n) * np.exp(-t * 6.9 / seconds), 6000)
        irs.append(ir / np.sqrt(np.sum(ir**2)))
    wl, wr = fftconvolve(x[:, 0], irs[0]), fftconvolve(x[:, 1], irs[1])
    dry = np.zeros((len(wl), 2), dtype=np.float32)
    dry[: len(x)] = x
    return (dry * (1 - wet) + np.stack([wl, wr], axis=1) * wet).astype(np.float32)


def keystrokes(name, max_hits=60):
    """从一段打字录音里切出单个按键，用于逐字对齐打字动画。"""
    x = load(name)
    mono = np.abs(x.mean(axis=1))
    w = 240
    env = np.array([mono[i : i + w].mean() for i in range(0, len(mono) - w, w)])
    thr = env.max() * 0.35
    hits, last = [], -1e9
    for i in range(1, len(env)):
        if env[i] > thr and env[i - 1] <= thr and (i - last) * w > SR * 0.09:
            hits.append(i * w)
            last = i
    return [x[max(0, h - 200) : h + int(0.11 * SR)] for h in hits[:max_hits]]


def splice(track, spans, offset, duration, xfade=0.03):
    """按 timing.json 的 music 拼接表把曲子剪成片长：spans = [{at, from, to}]，视频 at 秒起播放曲目 from~to 秒。
    拼接点要落在小节线上；接缝做 xfade 秒交叉淡化。曲子比片子短、或要在某段多重复几小节时用。
    from / to 是相对 offset（timing.json 的 musicOffset）的曲目时间，不是曲目绝对时间；各段 at 要首尾相接（下一段 at = 上一段 at + to - from）。"""
    xf = int(xfade * SR)
    parts = []
    for sp in spans:
        end = min(sp["to"], sp["from"] + duration - sp["at"])
        c = seg(track, offset + sp["from"], offset + end).copy()
        if parts:
            c[:xf] *= np.linspace(0, 1, xf)[:, None]
            parts[-1][-xf:] *= np.linspace(1, 0, xf)[:, None]
        parts.append(c)
    return np.concatenate(parts)[: int(duration * SR)].copy()


def muffle(clip, a, b, hz=420, gain=0.55, ramp=0.15):
    """把 a~b 秒低通「闷住」（音乐像隔了一堵墙），b 秒处立刻恢复全频。作曲没按计划给出安静段时，用它做出静场。"""
    i0, i1, k = int(max(0, a - ramp) * SR), int(b * SR), int(ramp * SR)
    out = clip.copy()
    w = np.ones(i1 - i0, dtype=np.float32)
    w[:k] = np.linspace(0, 1, k)
    w[-int(0.05 * SR):] = np.linspace(1, 0, int(0.05 * SR))
    out[i0:i1] = clip[i0:i1] * (1 - w[:, None]) + (lp(clip[i0:i1], hz) * gain).astype(np.float32) * w[:, None]
    return out


def build_in(clip, seconds, hp_hz=700, g0=0.3, g1=0.75):
    """音乐入场渐强：开头只保留高频、音量低，seconds 内逐渐打开到全频。比直接淡入更像「推进」。"""
    n = min(len(clip), int(seconds * SR))
    w = (np.linspace(0, 1, n) ** 1.6)[:, None]
    head = clip[:n]
    out = clip.copy()
    out[:n] = ((hp(head, hp_hz) * (1 - w) + head * w) * (g0 + (g1 - g0) * w)).astype(np.float32)
    return out


# ---------- 旁白 ----------

def level(clip, rms_db=-18.0):
    """把一段人声统一到给定 RMS（只算有声的部分），让每句旁白响度一致。"""
    m = clip.mean(axis=1)
    w = int(0.05 * SR)
    r = np.sqrt((m[: len(m) // w * w].reshape(-1, w) ** 2).mean(axis=1))
    act = r[r > r.max() * 0.1]
    cur = 20 * np.log10(np.sqrt((act**2).mean()) + 1e-9)
    return (clip * 10 ** ((rms_db - cur) / 20)).astype(np.float32)


def voice_lines(tm=None, rms_db=-18.0):
    """读 timing.json 的 voice.lines 和 audio-src/vo/<id>.mp3（由 elevenlabs.py vo 生成），返回 [(line, clip)]。"""
    tm = tm or timing()
    out = []
    for ln in (tm.get("voice") or {}).get("lines", []):
        if not os.path.exists(src(f"vo/{ln['id']}.mp3")):
            raise FileNotFoundError(f"缺旁白 audio-src/vo/{ln['id']}.mp3：先运行 python3 scripts/elevenlabs.py vo")
        clip = level(hp(load(f"vo/{ln['id']}.mp3"), 90).astype(np.float32), rms_db)
        out.append((ln, clip))
    return out


def duck_curve(spans, length, depth_db=-7.0, attack=0.08, release=0.35):
    """按人声时间段 [(开始, 结束[, 该句压低的 dB])] 生成音乐的逐采样增益：说话时压低 depth_db，前后平滑过渡。传给 Mix.place(duck=...)。"""
    n = int(length * SR)
    db = np.zeros(n, dtype=np.float32)
    t = np.arange(n) / SR
    for sp in spans:
        a, b = sp[0], sp[1]
        d = sp[2] if len(sp) > 2 else depth_db
        up = np.clip((t - (a - attack)) / attack, 0, 1)
        down = np.clip(((b + release) - t) / release, 0, 1)
        db = np.minimum(db, d * np.minimum(up, down))
    return (10 ** (db / 20)).astype(np.float32)


# ---------- 混音台 ----------

class Mix:
    def __init__(self, duration, tail=4.0):
        self.duration = duration
        self.buf = np.zeros((int((duration + tail) * SR), 2), dtype=np.float32)
        self.stems = {}
        self.spans = []

    def place(self, clip, at, gain=1.0, align=0.0, fade_in=0.0, fade_out=0.004, duck=None, tag=None):
        """把 clip 的第 align 秒对齐到时间轴的第 at 秒。duck 是 duck_curve() 的结果，用来在人声下压低音乐。
        tag="music" / "voice" 会另存一份分轨，vo_margin() 用它检查人声是否压得住音乐。"""
        start = int(round((at - align) * SR))
        clip = clip * gain
        if start < 0:
            clip, start = clip[-start:], 0
        clip = clip[: max(0, len(self.buf) - start)].copy()
        n = len(clip)
        if n == 0:
            return
        if fade_in > 0:
            k = min(n, int(fade_in * SR))
            clip[:k] *= np.linspace(0, 1, k)[:, None]
        if fade_out > 0:
            k = min(n, int(fade_out * SR))
            clip[-k:] *= np.linspace(1, 0, k)[:, None]
        if duck is not None:
            g = np.ones(n, dtype=np.float32)
            m = max(0, min(n, len(duck) - start))
            g[:m] = duck[start : start + m]
            clip *= g[:, None]
        self.buf[start : start + n] += clip
        if tag:
            stem = self.stems.setdefault(tag, np.zeros_like(self.buf))
            stem[start : start + n] += clip
            if tag == "voice":
                self.spans.append((start / SR, (start + n) / SR))

    def vo_margin(self, need=8.0):
        """每句旁白时间段里人声比音乐高多少 dB。低于 need 说明人声会被盖住：调高 voice.rmsDb 或加深 duckDb。"""
        if "voice" not in self.stems or "music" not in self.stems:
            return None
        db = lambda x: 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-9)
        worst = 99.0
        for a, b in self.spans:
            i, j = int(a * SR), int(b * SR)
            d = db(self.stems["voice"][i:j]) - db(self.stems["music"][i:j])
            worst = min(worst, d)
            print(f"  旁白 {a:6.2f}s  人声高出音乐 {d:+5.1f} dB" + ("   ← 偏低" if d < need else ""))
        print(f"vo_margin: 最低 {worst:+.1f} dB（要求 ≥ +{need:.0f}）")
        return worst

    def master(self, dest=None, lufs=-14.0, true_peak=-1.0, end_fade=0.8):
        """软削波 + 结尾淡出 + ffmpeg 两遍 loudnorm。默认 -14 LUFS（B 站 / YouTube / 抖音通用）。"""
        dest = dest or os.path.join(ROOT, "public", "audio", "mix.wav")
        out = hp(self.buf[: int(self.duration * SR)], 25)
        peak = np.abs(out).max() or 1.0
        out = np.tanh(out / peak * 1.4) / np.tanh(1.4) * 0.97
        k = int(end_fade * SR)
        out[-k:] *= np.linspace(1, 0, k)[:, None]
        raw = os.path.join(SRC, "_mix_raw.wav")
        wavfile.write(raw, SR, out.astype(np.float32))
        target = f"I={lufs}:TP={true_peak}:LRA=11"
        err = subprocess.run(
            ["ffmpeg", "-hide_banner", "-i", raw, "-af", f"loudnorm={target}:print_format=json", "-f", "null", "-"],
            capture_output=True, text=True,
        ).stderr
        s = json.loads(err[err.rindex("{") : err.rindex("}") + 1])
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", raw, "-af",
             f"loudnorm={target}:measured_I={s['input_i']}:measured_TP={s['input_tp']}:measured_LRA={s['input_lra']}:"
             f"measured_thresh={s['input_thresh']}:offset={s['target_offset']}:linear=true",
             "-ar", str(SR), "-c:a", "pcm_s16le", dest],
            check=True,
        )
        print(f"mix: input {s['input_i']} LUFS -> {lufs} LUFS  {dest}")
        return dest


def envelope(path=None, step=0.5, until=None):
    """打印成品混音的响度曲线，用来确认入场、渐强、爆发点是否符合设计（听不到声音时的主要依据）。"""
    path = path or os.path.join(ROOT, "public", "audio", "mix.wav")
    sr, x = wavfile.read(path)
    m = x.astype(np.float32).mean(axis=1) / 32768
    end = until or len(m) / sr
    for a in np.arange(0, end, step):
        s = m[int(a * sr) : int((a + step) * sr)]
        db = 20 * np.log10(np.sqrt(np.mean(s**2)) + 1e-9)
        print(f"{a:6.1f}s {db:6.1f} dB " + "#" * max(0, int(60 + db)))
