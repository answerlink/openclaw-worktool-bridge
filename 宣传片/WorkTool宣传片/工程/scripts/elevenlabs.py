"""ElevenLabs 音频生成（配音 / 音效 / 分段作曲 / 额度）。
key 读取顺序：环境变量 ELEVENLABS_API_KEY → 工程目录的 .env → 往上逐级找 .env → 当前目录往上逐级找 .env
（写在工作区根目录一次，所有项目通用）。

python3 scripts/elevenlabs.py quota
python3 scripts/elevenlabs.py voices --zh                       # 账号音色 + 音色库里的中文音色
python3 scripts/elevenlabs.py vo                                # 按 timing.json 的 voice 表生成全部旁白 + 转写校验
python3 scripts/elevenlabs.py vo --voice <voice_id> --out /tmp/vo-试听   # 换音色试听，不动正式旁白
python3 scripts/elevenlabs.py vo --model eleven_flash_v2_5 --out /tmp/vo-flash --only hook,cta   # 对比模型
python3 scripts/elevenlabs.py vo --takes 4                      # 每句最多生成 4 条，留转写最准的
python3 scripts/elevenlabs.py stt some.mp3                      # 转写任意音频（Scribe）
python3 scripts/elevenlabs.py check-mix                         # 转写成品混音，和旁白稿逐句比对（混音后必跑）
python3 scripts/elevenlabs.py sfx whoosh "Fast clean airy swoosh" --dur 0.8 --influence 0.6
python3 scripts/elevenlabs.py music score plan.json             # 需付费套餐；plan.json 是 {"chunks": [...]}

音效、作曲写到 audio-src/el/<名字>.mp3，并把提示词追加到 audio-src/el/prompts.tsv（写调研笔记的出处用）。
旁白写到 audio-src/vo/<句子 id>.mp3，校验结果在 audio-src/vo/report.json；文字、音色、模型都没变的句子不会重新生成。
timing.json 的 voice 可选：
  "keywords": ["产品名", "example"]    品牌名、网址等必须一字不差听到的词，转写里缺了就判 CHECK_WORD（整句相似度高也不放过）
  "sts": true                          生成后再用语音转语音换回 voiceId 的音色（克隆音色在 eleven_v3 上读音准但音色跑偏时用）
每句还会量句尾混响拖尾（从峰值 -20 dB 衰减到 -45 dB 的时间），超过 250 ms 判 ECHO：在音乐下听起来像回音。
免费套餐：音效、配音可用，作曲接口返回 402；同时只能跑 1~2 个请求，脚本遇到 429 会自动重试。
免费套餐的生成内容不含商用授权，交付时必须提醒用户。
"""
import argparse
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio-src", "el")
VO = os.path.join(ROOT, "audio-src", "vo")
API = "https://api.elevenlabs.io"
MAX_TEMPO = 1.12
MAX_TAIL_MS = 250
STS_MODEL = "eleven_multilingual_sts_v2"


def env_files():
    seen = set()
    for d in (ROOT, os.getcwd()):
        for _ in range(5):
            if d not in seen:
                seen.add(d)
                yield os.path.join(d, ".env")
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent


def key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    for env in env_files():
        if k:
            break
        if os.path.exists(env):
            for line in open(env, encoding="utf-8"):
                if line.strip().startswith("ELEVENLABS_API_KEY="):
                    k = line.split("=", 1)[1].strip().strip("'\"")
    if not k:
        sys.exit("缺少 ELEVENLABS_API_KEY：请让用户把 ELEVENLABS_API_KEY=... 写进工作区根目录或工程目录的 .env，或设成环境变量（不要贴到聊天里）")
    return k


def call(path, body=None, retries=4, files=None):
    if files is not None:
        boundary = uuid.uuid4().hex
        parts = []
        for name, value in (body or {}).items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        for name, path_ in files.items():
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{os.path.basename(path_)}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode())
            parts.append(open(path_, "rb").read() + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        data, ctype = b"".join(parts), f"multipart/form-data; boundary={boundary}"
    else:
        data = json.dumps(body).encode() if body is not None else None
        ctype = "application/json"
    for attempt in range(retries):
        req = urllib.request.Request(API + path, data=data, method="POST" if data else "GET")
        req.add_header("xi-api-key", key())
        if data:
            req.add_header("Content-Type", ctype)
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="ignore")[:300]
            if e.code == 429 and attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            sys.exit(f"HTTP {e.code}: {msg}")
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            # 国内网络到 api.elevenlabs.io 偶发 Connection reset；稍等重试，仍失败再提示检查代理
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            sys.exit(f"网络错误 {e}：检查代理（命令行可 export HTTPS_PROXY=http://127.0.0.1:<端口>；macOS 用 scutil --proxy 查端口）")


def save(name, audio, prompt, params):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.mp3")
    open(path, "wb").write(audio)
    with open(os.path.join(OUT, "prompts.tsv"), "a", encoding="utf-8") as f:
        f.write(f"{name}\t{prompt}\t{json.dumps(params, ensure_ascii=False)}\n")
    print(path)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    return float(out.stdout.strip() or 0)


def trim(src, dst, tempo=1.0):
    """Cut leading/trailing silence (and optionally speed up) so `at` in timing.json is where the first syllable lands."""
    rm = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02"
    chain = f"{rm},areverse,{rm},areverse"
    if tempo != 1.0:
        chain += f",atempo={tempo:.4f}"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", chain, "-ar", "48000", "-b:a", "256k", dst], check=True)


def tail_ms(path):
    import numpy as np

    raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    w = 480
    if len(x) < w * 4:
        return 0
    frames = x[: len(x) // w * w].reshape(-1, w)
    db = 20 * np.log10(np.sqrt((frames**2).mean(axis=1)) + 1e-9)
    pk = db.max()
    return int((np.where(db > pk - 45)[0][-1] - np.where(db > pk - 20)[0][-1]) * 10)


def to_voice(src_, dst, voice, settings):
    body = {"model_id": STS_MODEL, "voice_settings": json.dumps(settings), "remove_background_noise": "true"}
    open(dst, "wb").write(call(f"/v1/speech-to-speech/{voice}?output_format=mp3_44100_192", body, files={"audio": src_}))


def missing_words(keywords, said, heard):
    return [k for k in keywords if norm(heard).count(norm(k)) < norm(said).count(norm(k))]


def transcribe(path, lang=None):
    body = {"model_id": "scribe_v1"}
    if lang:
        body["language_code"] = lang
    return json.loads(call("/v1/speech-to-text", body, files={"file": path})).get("text", "")


def zh_num(m):
    n, digits, units = int(m.group()), "零一二三四五六七八九", ["", "十", "百", "千"]
    if n == 0 or n >= 10000:
        return m.group()
    out, s = "", str(n)
    for i, ch in enumerate(s):
        d, u = int(ch), units[len(s) - i - 1]
        out += (digits[d] + u) if d else ("零" if out and not out.endswith("零") else "")
    out = out.rstrip("零")
    return out[1:] if out.startswith("一十") else out


def norm(s):
    s = re.sub(r"\[[^\]]*\]", "", s)
    s = re.sub(r"\d+", zh_num, s.lower()).replace("点", ".")
    return re.sub(r"[\s，。、！？!?,.…：:；;\"'“”‘’（）()\-—·]", "", s)


def check_voice_model(voice, model, sts=False):
    """专业克隆音色按模型分别训练：没为这个模型训练时直接退出，并列出能用的模型。
    开了 voice.sts 且转音色模型训练过时放行：未训练的模型只负责读准，音色由语音转语音换回来。"""
    try:
        v = json.loads(call(f"/v1/voices/{voice}"))
    except SystemExit:
        return
    state = (v.get("fine_tuning") or {}).get("state") or {}
    if v.get("category") != "professional" or state.get(model) == "fine_tuned":
        return
    if sts and state.get(STS_MODEL) == "fine_tuned":
        print(f"音色「{v.get('name')}」没有为 {model} 训练：用 {model} 读准，再用 {STS_MODEL} 换回本人音色")
        return
    ready = [m for m, s in state.items() if s == "fine_tuned" and "sts" not in m]
    sys.exit(f"音色「{v.get('name')}」没有为 {model} 训练（{state.get(model, '无记录')}）。已训练的模型：{', '.join(ready) or '无'}。\n"
             f"两条路：① voice.model 换成其中一个（eleven_multilingual_v2 要 stability 0.85，品牌名夹英文时容易连读错、句尾拖尾长，务必配 keywords）；"
             f"② 保留 {model}、设 voice.sts: true（{STS_MODEL} 已训练时可用，读音准 + 本人音色）")


def voiceover(args):
    tm = json.load(open(os.path.join(ROOT, "src", "timing.json"), encoding="utf-8"))
    cfg = tm.get("voice")
    if not cfg or not cfg.get("lines"):
        sys.exit("timing.json 里没有 voice.lines：先写旁白表（见 references/配音.md）")
    voice = args.voice or cfg["voiceId"]
    model = args.model or cfg.get("model", "eleven_v4")
    sts = cfg.get("sts") and {"stability": 0.5, "similarity_boost": 0.9, "style": 0.0, "use_speaker_boost": True}
    check_voice_model(voice, model, bool(sts))
    lang = cfg.get("language", "zh")
    settings = cfg.get("settings", {"stability": 0.5, "similarity_boost": 0.75, "use_speaker_boost": True})
    keywords = cfg.get("keywords", [])
    out = args.out or VO
    os.makedirs(os.path.join(out, "raw"), exist_ok=True)
    lines = cfg["lines"]
    if args.only:
        wanted = set(args.only.split(","))
    report, cache_path = [], os.path.join(out, "cache.json")
    cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
    last = os.path.join(out, "report.json")
    prev = {r["id"]: r for r in json.load(open(last, encoding="utf-8")).get("lines", [])} if os.path.exists(last) else {}
    for r in prev.values():
        if r["status"] not in ("OK", "TOO_LONG"):
            cache.pop(r["id"], None)
    for i, ln in enumerate(lines):
        if args.only and ln["id"] not in wanted:
            continue
        say = ln.get("say", ln["text"])
        sig = hashlib.sha1(json.dumps([say, voice, model, settings, lang, sts]).encode()).hexdigest()
        raw = os.path.join(out, "raw", f"{ln['id']}.mp3")
        if cache.get(ln["id"]) != sig or not os.path.exists(raw):
            body = {"text": say, "model_id": model, "language_code": lang, "voice_settings": settings}
            # eleven_v3 不支持前后文拼接参数
            if not model.startswith("eleven_v3"):
                if i > 0:
                    body["previous_text"] = lines[i - 1].get("say", lines[i - 1]["text"])
                if i + 1 < len(lines):
                    body["next_text"] = lines[i + 1].get("say", lines[i + 1]["text"])
            best = -1.0
            for k in range(args.takes):
                take = raw.replace(".mp3", f".take{k}.mp3")
                open(take, "wb").write(call(f"/v1/text-to-speech/{voice}?output_format=mp3_44100_192", body))
                if sts:
                    # 转音色也会把短词读糊（「试试」→「设置」），所以按转完的结果挑
                    os.replace(take, take + ".tts.mp3")
                    to_voice(take + ".tts.mp3", take, voice, sts)
                    os.remove(take + ".tts.mp3")
                if args.takes == 1:
                    os.replace(take, raw)
                    break
                trim(take, take + ".t.mp3")
                got = transcribe(take + ".t.mp3", lang)
                score = difflib.SequenceMatcher(None, norm(say), norm(got)).ratio() - 0.5 * len(missing_words(keywords, say, got))
                os.remove(take + ".t.mp3")
                if score > best:
                    best = score
                    os.replace(take, raw)
                else:
                    os.remove(take)
                if best >= 0.95:
                    break
            cache[ln["id"]] = sig
            json.dump(cache, open(cache_path, "w"), indent=1)
        dst = os.path.join(out, f"{ln['id']}.mp3")
        trim(raw, dst)
        d = duration(dst)
        room = ln["end"] - ln["at"]
        tempo = 1.0
        if d > room:
            tempo = min(MAX_TEMPO, d / room)
            trim(raw, dst, tempo)
            d = duration(dst)
        heard = transcribe(dst, lang)
        score = difflib.SequenceMatcher(None, norm(say), norm(heard)).ratio()
        lost = missing_words(keywords, say, heard)
        tail = tail_ms(raw)
        status = "OK"
        if d > room + 0.05:
            status = "TOO_LONG"
        elif score < 0.85:
            status = "CHECK_TEXT"
        elif lost:
            status = "CHECK_WORD"
        elif tail > MAX_TAIL_MS:
            status = "ECHO"
        report.append({"id": ln["id"], "at": ln["at"], "dur": round(d, 2), "room": round(room, 2), "tempo": round(tempo, 3), "match": round(score, 2), "lost": lost, "tail_ms": tail, "heard": heard, "status": status})
        print(f"{status:10s} {ln['id']:10s} {d:5.2f}s / {room:4.2f}s  tempo {tempo:.2f}  match {score:.2f}  tail {tail:3d}ms{'  缺词 ' + ','.join(lost) if lost else ''}  「{heard}」")
    prev.update({r["id"]: r for r in report})
    report = [prev[ln["id"]] for ln in lines if ln["id"] in prev]
    json.dump({"voice": voice, "model": model, "sts": bool(sts), "lines": report}, open(last, "w"), ensure_ascii=False, indent=1)
    bad = [r for r in report if r["status"] != "OK"]
    if bad:
        print(
            f"\n{len(bad)} 句需要处理：TOO_LONG 删字或放宽时间窗；CHECK_TEXT 对照「听到的」改写（数字写成汉字、英文拆开）；"
            "CHECK_WORD 品牌词没读对，换模型（eleven_v3）或在品牌词前后加逗号断开；ECHO 混响拖尾长，换模型或音色（见 references/配音.md）"
        )
        sys.exit(1)


def check_mix(args):
    tm = json.load(open(os.path.join(ROOT, "src", "timing.json"), encoding="utf-8"))
    lines = (tm.get("voice") or {}).get("lines", [])
    src_ = args.file or os.path.join(ROOT, "public", "audio", "mix.wav")
    tmp = "/tmp/_check_mix.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src_, "-b:a", "192k", tmp], check=True)
    heard = transcribe(tmp, (tm.get("voice") or {}).get("language", "zh"))
    h = norm(heard)
    print("听到：", heard)
    missing = []
    for ln in lines:
        say = norm(ln.get("say", ln["text"]))
        # 在转写里滑动找最像的一段：容忍同音错一两个字，整句没听见才算漏
        best = max(difflib.SequenceMatcher(None, say, h[i : i + len(say)]).ratio() for i in range(max(1, len(h) - len(say) + 1)))
        if best < 0.8:
            missing.append(f"{ln['id']}({best:.2f})")
    total = difflib.SequenceMatcher(None, norm("".join(l.get("say", l["text"]) for l in lines)), h).ratio()
    print(f"整体匹配 {total:.3f}（要求 ≥ 0.97）；没听清的句子：{missing or '无'}")
    # 整片转写有随机误差：把没听清的句子截出来再转写两次，两次都对就只是转写误差，不用改混音
    lang = (tm.get("voice") or {}).get("language", "zh")
    real = []
    for ln in lines:
        if not any(m.startswith(ln["id"] + "(") for m in missing):
            continue
        cut = f"/tmp/_check_{ln['id']}.mp3"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(max(0, ln["at"] - 0.3)), "-to", str(ln["end"] + 0.3), "-i", src_, "-b:a", "192k", cut], check=True)
        say = norm(ln.get("say", ln["text"]))
        tries = [transcribe(cut, lang) for _ in range(2)]
        ok = all(difflib.SequenceMatcher(None, say, norm(x)).ratio() >= 0.85 for x in tries)
        print(f"  截段复查 {ln['id']}：{' / '.join(tries)}  → {'只是整片转写误差' if ok else '确实没听清'}")
        if not ok:
            real.append(ln["id"])
    script = "".join(l.get("say", l["text"]) for l in lines)
    lost = missing_words((tm.get("voice") or {}).get("keywords", []), script, heard)
    if lost:
        print(f"没听对的关键词：{lost}（品牌名、网址错一个字也要处理）")
    if total < 0.97 or real or lost:
        print("处理：确实没听清的句子，先重新生成那一句（vo --takes 4，删掉 raw/<id>.mp3）或换个说法；"
              "截段复查时人声被同时刻的音效盖住，再降那个音效或给该句加深 duckDb")
        sys.exit(1)


def voices(args):
    d = json.loads(call("/v2/voices?page_size=100"))
    for v in d.get("voices", []):
        lab = v.get("labels", {})
        print(f"{v['voice_id']}  {v['name'][:32]:32s} {v.get('category')}  {lab.get('gender')} {lab.get('age')} {lab.get('language') or ''}")
    if args.zh:
        for g in ("male", "female"):
            q = f"/v1/shared-voices?language=zh&gender={g}&page_size=12&sort=usage_character_count_1y"
            for v in json.loads(call(q)).get("voices", []):
                print(f"{v['voice_id']}  {v['name'][:32]:32s} 音色库  {v.get('gender')} {v.get('age')} {v.get('accent')} {v.get('use_case')}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("quota")
    vs = sub.add_parser("voices")
    vs.add_argument("--zh", action="store_true")
    v = sub.add_parser("vo")
    v.add_argument("--voice", help="覆盖 timing.json 里的 voiceId（试音色）")
    v.add_argument("--model", help="覆盖 timing.json 里的 model（对比模型，配合 --out 用）")
    v.add_argument("--out", help="输出目录，默认 audio-src/vo")
    v.add_argument("--only", help="只生成这些句子 id，逗号分隔")
    v.add_argument("--takes", type=int, default=1, help="每句最多生成几条，留转写最准的（克隆音色咬字不稳时用 3~4）")
    cm = sub.add_parser("check-mix")
    cm.add_argument("file", nargs="?")
    st = sub.add_parser("stt")
    st.add_argument("file")
    st.add_argument("--lang", default="zh")
    s = sub.add_parser("sfx")
    s.add_argument("name")
    s.add_argument("prompt")
    s.add_argument("--dur", type=float, help="0.5~30 秒，不填由模型决定")
    s.add_argument("--influence", type=float, default=0.6, help="0~1，越高越贴提示词")
    s.add_argument("--loop", action="store_true", help="无缝循环（适合铺底律动）")
    m = sub.add_parser("music")
    m.add_argument("name")
    m.add_argument("plan", help="composition plan JSON：{\"chunks\": [{text, duration_ms, positive_styles, negative_styles}]}")
    a = ap.parse_args()

    if a.cmd == "quota":
        d = json.loads(call("/v1/user/subscription"))
        print(f"套餐 {d.get('tier')} · 已用 {d.get('character_count')} / {d.get('character_limit')}")
    elif a.cmd == "voices":
        voices(a)
    elif a.cmd == "vo":
        voiceover(a)
    elif a.cmd == "check-mix":
        check_mix(a)
    elif a.cmd == "stt":
        print(transcribe(a.file, a.lang))
    elif a.cmd == "sfx":
        body = {"text": a.prompt, "prompt_influence": a.influence, "loop": a.loop}
        if a.dur:
            body["duration_seconds"] = a.dur
        save(a.name, call("/v1/sound-generation?output_format=mp3_44100_192", body), a.prompt, {k: v for k, v in body.items() if k != "text"})
    elif a.cmd == "music":
        plan = json.load(open(a.plan, encoding="utf-8"))
        body = {"composition_plan": plan, "model_id": "music_v2_5"}
        save(a.name, call("/v1/music?output_format=mp3_48000_320", body), os.path.basename(a.plan), {"chunks": len(plan.get("chunks", []))})


if __name__ == "__main__":
    main()
