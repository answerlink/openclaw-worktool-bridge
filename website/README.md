# WorkTool 官网

独立静态官网，不改变管理控制台。无需构建，可部署到静态托管服务的域名根目录。

## 页面结构

- `/`：产品官网首页
- `/videos/`：视频中心
- `/videos/worktool-overview/`：产品短片详情，含播放器、章节跳转及原片链接
- `assets/media.js`：所有视频、图片的地址配置
- `assets/style.css`、`assets/site.js`：共享样式与交互

## 本地预览

在本目录运行 `npx --yes http-server . -p 18770 -a 127.0.0.1 -c-1`，打开 http://127.0.0.1:18770 。

首次准备素材：从仓库根目录运行 `python3 website/scripts/package_media.py`，需要 Python 与 Pillow，并保留本地的宣传片交付文件。脚本生成根目录 `七牛云上传/`，以及仅供本地预览的 `website/media` 符号链接。媒体包、预览链接均已加入 Git 忽略。

## 七牛云上传与地址替换

当前媒体已连接到 `https://cdn.asrtts.cn/static/worktool_console/v1`，本地预览与正式部署均读取 CDN，无需复制媒体到官网目录。

上传包中的 `worktool/v1/` 对应 CDN 的 `static/worktool_console/v1/`。保留其下的 `images/` 和 `videos/` 文件名与层级。例如视频地址为 `https://cdn.asrtts.cn/static/worktool_console/v1/videos/worktool-overview-1080p.mp4`。

更换媒体目录时修改 `assets/media.js` 的 `CDN_BASE`；单个文件地址不同可填写 `MEDIA_OVERRIDES`。仅使用 1080p 视频与最大 1920×1080 图片。

## 部署

只需发布本目录的 HTML 与 assets 文件夹，保留 videos 的目录结构。不发布 media 符号链接、scripts、README 或 .qa。静态服务需支持目录 index.html，网站需位于域名根目录。媒体独立由七牛云提供。

控制台与文档链接使用 console.worktool.ymdyes.cn。最终官网域名确定后，可补充 canonical、社交分享绝对地址与站点地图。
