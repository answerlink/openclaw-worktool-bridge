# WorkTool 极简宣传片工程

本次已确认的 A 风格版本，约 52 秒、横屏 30fps。分镜与素材来源见上一级文档。

## Git 与本地文件
Git 保留 React/Remotion 源码、脚本、锁文件、分镜文档、样帧和已脱敏 JPEG。
不提交 node_modules、out、音视频、音频源素材、生成字体、网页构建输出、原始页面快照、环境变量文件。
本地已有成片不删除。重新克隆后须恢复音频并生成字体，不能直接渲染。

## 安装与恢复素材
在此目录运行（Python 建议使用已激活的虚拟环境）：
~~~sh
npm ci
python3 -m pip install -r requirements.txt
mkdir -p audio-src
python3 scripts/music.py get music 173 -o audio-src
cp audio-src/173.mp3 audio-src/music.mp3
npm run fonts
npm run mix
npm run check:assets
npm run lint
~~~
配乐为 Mixkit #173「Better Times are Coming」，线上营销用途许可与来源见上一级调研笔记。
字体默认使用本机苹方、微软雅黑或 Noto Sans CJK，见 fonts.json；生成后的字体不入库。
未安装 Chrome 时 Remotion 可下载所需浏览器；也可设置 CHROME_PATH 指向现有 Chrome。

## 渲染
~~~sh
npm run render:preview
npm run render:4k
npm run render:1080
npm run web:build
npm run web:serve
~~~
输出在 out/，成片按交付说明复制到上一级。浏览器打开本地播放器需要 HTTP 服务，不直接双击 HTML。

## 主要文件
- src/timing.json：统一时间轴与节拍。
- src/scenes/Design.tsx：画面、字幕与动效。
- scripts/mix.py：配乐与音效编排。
- public/shots/：已脱敏真实页面，focus-* 为裁切，thumb-* 为缩略图。
- scripts/render_snapshots.py：本地离线重渲染快照；原始快照不随 Git 分发。
