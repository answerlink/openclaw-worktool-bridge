"""按推文 id 抓取公开元数据与原始媒体（fxtwitter 公共接口，无需登录 X）。

python3 scripts/xgrab.py 2105757136219504862 2105735266032095349 ...   # 写入 out/x/<id>/：meta.json + 原图(name=orig) / 原视频
python3 scripts/xgrab.py --index                                       # 汇总 out/x/index.tsv（作者、时间、点赞、正文）

被引用的帖子和被回复的帖子会顺带抓一层（常常是真正的原帖）。
国内网络下 pbs.twimg.com 会被重置连接：脚本自动读取系统代理（macOS 的 scutil 设置），
也可以手动 export HTTPS_PROXY=http://127.0.0.1:<端口>。
"""
import json
import os
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out", "x")


def proxy():
    p = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or urllib.request.getproxies().get("https")
    if p and "://" not in p:
        p = "http://" + p
    return p


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def grab(tid, depth=0):
    d = os.path.join(OUT, tid)
    os.makedirs(d, exist_ok=True)
    t = json.loads(fetch(f"https://api.fxtwitter.com/status/{tid}")).get("tweet")
    if not t:
        print(tid, "无法获取")
        return
    meta = {
        "id": tid,
        "url": t.get("url"),
        "author": t["author"]["screen_name"],
        "name": t["author"].get("name"),
        "created_at": t.get("created_at"),
        "likes": t.get("likes"),
        "retweets": t.get("retweets"),
        "views": t.get("views"),
        "text": t.get("text"),
        "replying_to_status": t.get("replying_to_status"),
        "quote": (t.get("quote") or {}).get("id"),
        "media": [],
    }
    for i, m in enumerate((t.get("media") or {}).get("all", [])):
        url = m["url"]
        ext = "mp4" if m["type"] in ("video", "gif") else "jpg"
        path = os.path.join(d, f"{i}.{ext}")
        if not os.path.exists(path):
            if ext == "jpg" and "name=" not in url:
                url += ("&" if "?" in url else "?") + "name=orig"
            cmd = ["curl", "-sSL", "--retry", "3", "-m", "300", "-o", path, url]
            if proxy():
                cmd[1:1] = ["-x", proxy()]
            if subprocess.run(cmd, check=False).returncode != 0 and os.path.exists(path):
                os.remove(path)
                print(f"   下载失败：{url}（检查代理）")
        meta["media"].append({"type": m["type"], "w": m.get("width"), "h": m.get("height"), "file": os.path.basename(path), "src": m["url"]})
    json.dump(meta, open(os.path.join(d, "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{tid} @{meta['author']} {meta['created_at']} ♥{meta['likes']} 媒体{[(m['type'], m['w'], m['h']) for m in meta['media']]}")
    print("   ", (meta["text"] or "").replace("\n", " ")[:160])
    if meta["quote"] and depth == 0:
        grab(meta["quote"], 1)
    if meta["replying_to_status"] and depth == 0:
        grab(meta["replying_to_status"], 1)


def index():
    rows = []
    for tid in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, tid, "meta.json")
        if os.path.exists(p):
            m = json.load(open(p, encoding="utf-8"))
            rows.append("\t".join([tid, "@" + m["author"], m["created_at"] or "", str(m["likes"]), str(len(m["media"])), m["url"] or "", (m["text"] or "").replace("\n", " ")[:120]]))
    open(os.path.join(OUT, "index.tsv"), "w", encoding="utf-8").write("\n".join(rows) + "\n")
    print("\n".join(rows))


if __name__ == "__main__":
    if sys.argv[1:] == ["--index"]:
        index()
    else:
        for tid in sys.argv[1:]:
            try:
                grab(tid)
            except Exception as e:  # noqa: BLE001
                print(tid, "失败", e)
