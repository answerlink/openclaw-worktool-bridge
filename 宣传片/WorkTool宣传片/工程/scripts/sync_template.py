"""把 template 里后来改进过的通用文件同步进本项目（改版、续做旧项目时先跑）。

python3 scripts/sync_template.py            列出和 template 不一样的通用文件（不改任何东西）
python3 scripts/sync_template.py --diff     同时打印差异
python3 scripts/sync_template.py --apply    用 template 版覆盖这些文件（先确认差异里没有本项目特有的改动）

只比较和风格无关的通用文件：scripts/ 下除 mix.py 外的脚本、web/ 的播放逻辑。
mix.py、timing.json、场景、theme、fonts.json、web/config.ts、web/style.css 是每个项目自己的，不碰。

template 的位置按顺序找：环境变量 PROMO_TEMPLATE → 克隆用法的 <仓库>/template（本工程在 outputs/<项目>/工程）
→ 工作区和用户目录下各 AI 工具的 skills 目录里装的 promo-video-maker（Skill 用法）。
"""
import argparse
import filecmp
import glob
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = "promo-video-maker"
SKILL_DIRS = [".claude/skills", ".cursor/skills", ".agents/skills", ".codex/skills", ".config/agents/skills"]
OWN = {"scripts/mix.py"}


def find_template():
    if os.environ.get("PROMO_TEMPLATE"):
        return os.path.abspath(os.environ["PROMO_TEMPLATE"])
    workspace = os.path.normpath(os.path.join(ROOT, "..", "..", ".."))
    if os.path.isfile(os.path.join(workspace, "template", "scripts", "sync_template.py")):
        return os.path.join(workspace, "template")
    for base in (workspace, os.path.expanduser("~")):
        for d in SKILL_DIRS:
            for skill_md in glob.glob(os.path.join(base, d, "*", "SKILL.md")):
                if f"name: {SKILL}" in open(skill_md, encoding="utf-8").read():
                    return os.path.join(os.path.dirname(skill_md), "template")
    return None


TEMPLATE = find_template()
GENERIC = ["scripts", "web/App.tsx", "web/main.tsx", "web/vite.config.ts"]


def generic_files():
    for g in GENERIC:
        base = os.path.join(TEMPLATE, g)
        if os.path.isfile(base):
            yield g
            continue
        for name in sorted(os.listdir(base)):
            rel = f"{g}/{name}"
            if rel not in OWN and name.endswith((".py", ".js", ".mjs", ".ts", ".tsx")):
                yield rel


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diff", action="store_true")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    if not TEMPLATE or not os.path.isdir(TEMPLATE) or os.path.samefile(TEMPLATE, ROOT):
        sys.exit("找不到 template：本脚本要在 <输出目录>/<项目>/工程/ 下运行；template 不在默认位置时用 PROMO_TEMPLATE=<工具目录>/template 指定")
    print(f"对照 {TEMPLATE}")
    css = os.path.join(ROOT, "src", "index.css")
    if os.path.exists(css) and "max-width: none" not in open(css, encoding="utf-8").read():
        print("注意  src/index.css 缺少 img { max-width: none; }：放大的截图会被横向压扁，照 template/src/index.css 补上")
    changed = []
    for rel in generic_files():
        t, p = os.path.join(TEMPLATE, rel), os.path.join(ROOT, rel)
        if not os.path.exists(p):
            changed.append(rel)
            print(f"缺少  {rel}")
        elif not filecmp.cmp(t, p, shallow=False):
            changed.append(rel)
            print(f"不同  {rel}")
            if a.diff:
                subprocess.run(["diff", "-u", p, t])
    if not changed:
        print("通用文件都和 template 一致")
        return
    if a.apply:
        for rel in changed:
            shutil.copy2(os.path.join(TEMPLATE, rel), os.path.join(ROOT, rel))
        print(f"已用 template 版覆盖 {len(changed)} 个文件；接着跑 npm run lint 和 npm run mix 确认没坏")
    else:
        print("确认差异都是 template 的改进（不是本项目特有的改动）后加 --apply")


if __name__ == "__main__":
    main()
