"""Collect website media into one ignored Qiniu upload folder. Run from any cwd."""
from pathlib import Path
import shutil, hashlib, json
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "宣传片/WorkTool宣传片"
DEST = ROOT / "七牛云上传/worktool/v1"
for folder in ["videos", "images"]:
    (DEST / folder).mkdir(parents=True, exist_ok=True)
# Remove the obsolete CDN export when rebuilding an existing bundle.
(DEST / "videos/worktool-overview-4k.mp4").unlink(missing_ok=True)
for source, target in [
    ("宣传片 1080p.mp4", "worktool-overview-1080p.mp4"),
]:
    shutil.copy2(SOURCE / source, DEST / "videos" / target)
with Image.open(SOURCE / "封面.jpg") as im:
    im.thumbnail((1920, 1080))
    im.convert("RGB").save(DEST / "images/video-poster.jpg", quality=90)
for source, target in [
    ("dashboard", "dashboard"), ("robots", "robots"), ("providers", "providers"),
    ("scheduled", "scheduled"), ("events", "events"), ("tags", "tags"),
    ("task-center", "task-center"), ("logs", "monitor"),
]:
    with Image.open(SOURCE / ("工程/public/shots/" + source + ".jpg")) as im:
        im.thumbnail((1920, 1080))
        im.save(DEST / ("images/" + target + ".webp"), quality=87)
manifest = []
for path in sorted(DEST.rglob("*")):
    if path.is_file():
        manifest.append({"key": path.relative_to(DEST.parents[1]).as_posix(),
                         "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
(ROOT / "七牛云上传/文件清单.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
shutil.copy2(ROOT / "website/UPLOAD.md", ROOT / "七牛云上传/上传说明.md")
preview = ROOT / "website/media"
if not preview.exists() and not preview.is_symlink():
    preview.symlink_to("../七牛云上传", target_is_directory=True)
print("Upload root:", DEST.parents[1])
print("Files:", len(manifest), "MiB:", round(sum(item["bytes"] for item in manifest) / 1024 / 1024, 2))
