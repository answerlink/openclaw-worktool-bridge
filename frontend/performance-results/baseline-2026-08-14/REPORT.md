# WorkTool 线上首次访问基线（2026-08-14）

目标：<https://console.worktool.ymdyes.cn/>

方法：移动端和桌面端各 3 轮；每轮使用新的无痕 Chrome 临时用户目录。Lighthouse 使用标准配置并取中位数；正文探针在本机真实网络、不做 Lighthouse 限速的条件下记录首次正文出现。

线上未登录访问最终由前端路由进入 `/login?next=%2F`，正文为登录/注册界面。

## 中位数

| 指标 | 移动端 Lighthouse | 桌面端 Lighthouse |
|---|---:|---:|
| 性能分 | 56 | 95 |
| FCP | 3,919 ms | 953 ms |
| LCP | 4,462 ms | 1,077 ms |
| Speed Index | 5,922 ms | 1,604 ms |
| TBT | 457 ms | 8 ms |
| CLS | 0.013 | 0.003 |
| 可交互时间 | 10,847 ms | 1,540 ms |
| TTFB | 24 ms | 25 ms |
| 总传输量 | 1,797,012 B | 1,797,017 B |
| JS 执行时间 | 1,229 ms | 229 ms |
| 主线程时间 | 2,253 ms | 585 ms |

不做网络/CPU 模拟的冷启动正文探针中位数：移动端 1,358 ms，桌面端 1,398 ms。这个值用于下次同机同网对比，不能替代移动端 Lighthouse 模拟结果。

## 证据与瓶颈

1. 首要问题是登录页也加载整套后台代码。当前构建只有一个 `1,970.96 kB` 的压缩前 JS 文件（gzip `598.08 kB`）。`App.tsx` 顶部同步导入全部 20 个后台页面，登录页同样需要下载、解析它们。Lighthouse 估算本项目主 JS 有 `412,490 B / 589,149 B`（约 70%）在首屏未使用。

2. 默认关闭的聊天组件仍立即启动。Lighthouse 的 51 个请求中，44 个来自 `question.ymdyes.cn`，传输约 `1,182,483 B`，占总传输的 65.8%。其中包含约 302 kB 的 `_app`、243 kB 的 `html2pdf` 和多批 Next.js chunks。组件脚本位于 `index.html`，`defer` 只推迟执行到 HTML 解析后，不会等用户打开聊天窗口。

3. LCP 元素只是“登录后管理你的机器人与规则”这行文本；LCP 4,462 ms 中约 3,862 ms（87%）属于 render delay。服务器响应约 24 ms，说明优先优化源代码和第三方加载，而不是后端接口或 HTML TTFB。

4. CLS 已经良好，不应为了优化而大幅重做布局。桌面端也已良好；移动端的弱 CPU/网络场景是本轮主要目标。

## 下一轮优化顺序

### P0：聊天组件按需加载

- 登录页不加载聊天 iframe。
- 登录后的管理台可改为用户点击悬浮按钮后再插入脚本，或至少在首屏稳定并空闲后加载。
- 如果业务要求登录页必须展示入口，只先渲染本地轻量按钮；点击后才加载 `iframe.js`。

预期影响：直接减少最多约 1.18 MB、44 个首访请求，并降低与主应用竞争的 JS 执行。应先单独部署这一项，以便量化其独立收益。

### P0：路由级代码拆分

- 保留登录页和必要框架为入口包。
- 将 `DashboardPage`、`RobotPage`、图表页及管理员页面改为 `React.lazy(() => import(...))`，用统一 `Suspense` 占位。
- 管理员专用页面只有通过权限检查后才请求。
- 检查 `recharts` 等大依赖是否只进入实际使用它们的路由 chunk。

预期影响：显著降低主应用 598 kB gzip 和 Lighthouse 指出的 412 kB 首屏未使用代码，同时降低移动端解析、编译和主线程时间。

### P1：去掉首次空白渲染

- `authReady` 初始为 `false`，`App` 首次返回 `null`，之后 effect 才确认无 token 并渲染登录页。可以在初始化 state 时同步读取 token；明确无 token 且访问登录路径时立即渲染登录壳。
- 给异步认证和懒加载路由提供稳定的轻量骨架，避免白屏。

### P1：传输与持续预算

- 当前 hashed assets 已有一年 immutable 缓存且 gzip 已开启，配置方向正确。
- 可在生产入口层开启 Brotli 作为补充，但优先级低于减少 JS 本身。
- 在 CI 增加预算：移动端 LCP ≤ 2.5 s、TBT ≤ 200 ms、CLS ≤ 0.1；首屏自有 JS gzip 建议先压到 250 kB 以下，再逐步收紧。

## 下次复测

使用同一台机器与网络运行：

```bash
cd frontend
npm ci
npm run perf:baseline -- --url https://console.worktool.ymdyes.cn/ --runs 3 --profile both --out performance-results/after
npm run perf:compare -- performance-results/baseline-2026-08-14 performance-results/after --out performance-results/comparison.md
```

完整 Lighthouse 原始 JSON 默认保留在本地但被 Git 忽略；`summary.json`、CSV 和本报告可纳入版本管理。
