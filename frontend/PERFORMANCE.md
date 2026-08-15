# WorkTool 前端性能量化

这套脚本用于重复测量首次访问，并在每次部署后进行同口径对比。它包含两组互补数据：

- Lighthouse：Google 的实验室性能模型，输出性能分、FCP、LCP、CLS、TBT、Speed Index、TTFB、JS 执行时间和总传输量。
- 首次正文探针：每轮启动全新无痕 Chrome 临时配置、禁用页面缓存，记录 `#root` 出现至少 20 个正文字符的时刻，以及真实本机网络下的导航、资源和 Web Performance 数据。

## 建立基线

在 `frontend` 目录运行：

```bash
npm ci
npm run perf:baseline -- --url https://console.worktool.ymdyes.cn/ --runs 3 --profile both
```

结果默认写入 `performance-results/<UTC 时间>/`：

- `summary.json`：中位数、环境信息和全部明细，适合机器读取和版本对比。
- `lighthouse-runs.csv`：每轮 Lighthouse 摘要。
- `cold-content-runs.csv`：每轮首次正文探针摘要。
- `lighthouse-<profile>-<run>.json`：完整原始 Lighthouse 报告，可追踪具体审计项。

可通过 `--out` 固定目录；CI 或不同机器运行时建议显式传 `--chrome-path` 或设置 `CHROME_PATH`。

## 部署后对比

新版仍需使用同一台机器、相同网络、相同 Chrome 主版本和相同轮数：

```bash
npm run perf:baseline -- --url https://console.worktool.ymdyes.cn/ --runs 3 --profile both --out performance-results/after
npm run perf:compare -- performance-results/before performance-results/after --out performance-results/comparison.md
```

每轮都是新的临时用户目录，因此不会继承 Cookie、登录态、Service Worker 或 HTTP 缓存。脚本不会登录，也不会提交表单。

## 判读口径

Core Web Vitals 的“良好”目标（第 75 百分位）通常为：LCP 不高于 2.5 秒、CLS 不高于 0.1、INP 不高于 200 毫秒。Lighthouse 的 TBT 是实验室环境中对交互阻塞的代理，不等于真实用户 INP。

本脚本回答的是“这个版本在受控环境下是否变快”。Google Search Console / Chrome UX Report 的字段数据来自真实用户，按滚动时间窗聚合，发布后不会立即变化。因此发布验收应同时保留实验室对比，并在有足够流量后复查字段数据。

## 降低噪声

- 采用至少 3 轮的中位数；重要发布建议 5 轮。
- 前后测试不要更换网络、机器、电源模式或 Chrome 版本。
- 关闭大量占用 CPU/网络的应用。
- 若某轮遇到超时或明显网络故障，保留原始报告并重新运行整组，不要只挑最好成绩。
- 公网页面会加载第三方聊天组件；它是用户真实体验的一部分，默认不屏蔽。若要判断其单独影响，应另做“启用/禁用组件”的 A/B 部署。
