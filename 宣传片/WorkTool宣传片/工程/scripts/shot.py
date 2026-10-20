"""直接打开网址截 4K 页面图（Playwright，不依赖任何 AI 工具的浏览器插件）。

python3 scripts/shot.py <网址> <名字>                          # 1920×1080 @2x → out/shots/<名字>-0.jpg（3840×2160）
python3 scripts/shot.py <网址> <名字> --scroll 0 1400 2800      # 主滚动容器滚到这些位置各截一张
python3 scripts/shot.py <网址> <名字> --tall 4200 --scale 1.25  # 视口拉高截整页长图（内容区内部滚动的站点也能截全）
python3 scripts/shot.py <网址> <名字> --hide ".banner" ".float-bar" --eval "document.title = ''"
python3 scripts/shot.py --login <网址>                          # 需要登录的站点：先跑这一句
python3 <工具目录>/template/scripts/shot.py file:///<绝对路径>/A.html A --out "<输出目录>/<项目>/样帧"   # 还没建工程时截代码画的风格样帧

--login 会打开一个有界面的浏览器窗口，请用户在里面登录，登录完关掉窗口即可。
登录状态保存在 out/.browser-profile/，之后这个工程里的截图都带着它（这个目录含 cookie，不要分享）。
默认隐藏右上角的账号头像（顶部 80px、右侧 240px 内的图片），--keep-avatar 保留。
需要 Playwright：pip install playwright && playwright install chromium
"""
import argparse
import os

from playwright.sync_api import TimeoutError as PwTimeout
from playwright.sync_api import sync_playwright

from snapshot import AVATAR, SCROLL

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = os.path.join(ROOT, "out", ".browser-profile")

LAZY = """async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const els = [document.scrollingElement, ...document.querySelectorAll('*')].filter(e => e && (e === document.scrollingElement ||
    (e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY || ''))));
  for (const s of els.slice(0, 8)) {
    for (let y = 0; y < Math.min(s.scrollHeight, 20000); y += 700) { s.scrollTop = y; await sleep(100); }
    s.scrollTop = 0;
  }
  window.scrollTo(0, 0);
}"""


def open_page(ctx, url, wait):
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    pg.goto(url, wait_until="load", timeout=90000)
    try:
        pg.wait_for_load_state("networkidle", timeout=15000)
    except PwTimeout:
        pass
    pg.wait_for_timeout(int(wait * 1000))
    return pg


def login(url):
    os.makedirs(PROFILE, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PROFILE, headless=False, viewport=None)
        pg = open_page(ctx, url, 0)
        print("已打开浏览器窗口：请在里面登录，登录完成后关掉这个窗口。")
        pg.wait_for_event("close", timeout=0)
        ctx.close()
    print(f"登录状态已保存到 {PROFILE}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("name", nargs="?")
    ap.add_argument("--login", action="store_true", help="打开有界面的浏览器，让用户登录")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--scale", type=float, default=2)
    ap.add_argument("--scroll", type=int, nargs="*", default=[0])
    ap.add_argument("--tall", type=int, help="视口高度（css 像素），截整页长图")
    ap.add_argument("--hide", nargs="*", default=[], help="截图前隐藏的 CSS 选择器（横幅、悬浮条、弹窗）")
    ap.add_argument("--eval", dest="js", help="截图前在页面里执行的 JS（清理页面用）")
    ap.add_argument("--wait", type=float, default=1.5, help="页面加载后再等几秒")
    ap.add_argument("--keep-avatar", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "out", "shots"))
    a = ap.parse_args()

    if a.login:
        return login(a.url)
    if not a.name:
        ap.error("缺少 <名字>")
    os.makedirs(a.out, exist_ok=True)
    view = {"viewport": {"width": a.width, "height": a.tall or a.height}, "device_scale_factor": a.scale}
    with sync_playwright() as p:
        if os.path.isdir(PROFILE):
            ctx = p.chromium.launch_persistent_context(PROFILE, headless=True, **view)
        else:
            ctx = p.chromium.launch().new_context(**view)
        pg = open_page(ctx, a.url, a.wait)
        pg.evaluate(LAZY)
        pg.wait_for_timeout(800)
        if not a.keep_avatar:
            pg.evaluate(AVATAR)
        for sel in a.hide:
            pg.add_style_tag(content=f"{sel} {{ display: none !important; }}")
        if a.js:
            pg.evaluate(f"() => {{ {a.js} }}")
        for i, y in enumerate([0] if a.tall else a.scroll):
            pg.evaluate(SCROLL, y)
            pg.wait_for_timeout(900)
            path = os.path.join(a.out, f"{a.name}-{'tall' if a.tall else i}.jpg")
            pg.screenshot(path=path, type="jpeg", quality=90)
            print(path, pg.title()[:40])
        ctx.close()


if __name__ == "__main__":
    main()
