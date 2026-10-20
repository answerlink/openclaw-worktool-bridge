# WorkTool Console 产品宣传片

自主自由创作，1920×1080，30fps，约39.4秒；原始产品页面 + 虚构演示数据。

## 文件
- `out/worktool-promo.mp4`：配乐 + 音效。
- `out/worktool-promo-sfx.mp4`：无配乐，保留音效；同一合成的 bgm=false 音轨，封装时复用配乐版的视频流；画面逐帧相同。
- `design/creative-spec.md`：产品简报、视觉 tokens、功能映射、分镜与数据口径。
- `src/workbench.ts`：镜头、字幕、音效和音乐多轨清单。
- `out/independent-review.md`：独立审查。
- `analysis/`：节拍、音频偏移和一致性校验记录。

## 预览和再导出

```sh
npm ci
npm run dev
npm run render
npx remotion render src/index.ts WorkToolPromo out/worktool-promo-sfx.mp4 --props=props-nobgm.json
```

本机动效工作台： http://localhost:5198/?import=project

```sh
node /Users/jialun/.codex/skills/video-shotcraft/workbench/scripts/open.mjs "$PWD"
```

品牌开场、自动化引导、品牌结尾和全部叙事字幕支持文字/颜色编辑，所有片段支持时间、位置和变速；截图中的原生界面文字需要重采素材。

## 素材重采

先在 `../frontend` 启动 Vite 至127.0.0.1:5177，再运行 `node scripts/capture.mjs`。脚本只访问本地服务，全部API请求由虚构fixtures响应，外网资源请求会被拦截。截图基于原始React界面，不修改业务源码。

音频：House Vibez / Lily J / Mixkit 745；SFX来源及URL在public/audio/ATTRIBUTION.md。music-master.wav是源音乐稳定8小节循环后加入首尾淡化的版本，riser.wav是Air zoom vacuum的反向处理。素材原始来源记录随工程保留。

本机Chrome路径写在remotion.config.ts；其他电脑请修改或删除该设置以使用Remotion下载的浏览器。


## 版本归档与 Git 范围
这是此前的独立方案，使用原始产品页面与虚构演示数据。本次确认的 A 风格版本位于 ../宣传片/WorkTool宣传片/。
源码、设计文档、演示截图及分析 JSON 保留在 Git；out、node_modules 和音视频不提交，本地文件保留。
从 Git 克隆后需自行恢复 public/audio 下素材，再渲染。所用曲目与音效来源见 public/audio/ATTRIBUTION.md；
prepare-audio.py 属于原制作环境脚本，其素材路径需按本机位置调整。
