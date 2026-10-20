# WorkTool Console · 让企微协作自动运转
模式：用户已选自主自由创作，2026-10-20。Agent 自主放行，先定案后采集。

## 产品简报与执行决策
受众：企业微信运营、客服和团队管理者；用于官网/横屏社交媒体介绍。
源码依据：main.tsx 主题；RobotPage 回复规则；AIHubPage 的 OpenAI兼容/FastGPT/OpenClaw；ScheduledTaskPage 定时任务；MessageLogPage 消息监控；DashboardPage 趋势。
必须展示：机器人及规则统一管理、AI引擎、定时任务、消息问答监控、运营趋势。
事件任务、消息转发是辅助能力，本片不展开。不宣称性能收益、无人值守保证或客户案例。
|需求|执行|依据|
|---|---|---|
|宣传片|约40秒、1920×1080、30fps、中文|多功能后台留足阅读时间|
|真实页面|本地原始React页面，API全部拦截注入虚构数据|不使用线上客户和消息|
|音频|House底乐+电影SFX；无旁白；双版本|字幕承担叙述，兼容静音播放|
|后续修改|Remotion+workbench多轨|字幕、颜色、音效可编辑|

## 视觉方向和styleframe
候选①米白灰青工作台（采用）②全深色发布会（只用于片尾）③霓虹（舍弃，与产品不符）。
Tokens来自main.tsx：#f6f3ed底、#fffdf8表面、#2f3b40字、#5f8f98品牌、圆角10。
字体与Ant Design一致：-apple-system/BlinkMacSystemFont/Segoe UI/PingFang SC/sans-serif，400/600/700；8px间距；96px安全边距。
主标题110–140px、叙事字幕64px、辅助36–42px。页面小字是背景纹理，高清特写内容可读。片尾深色由源文字色扩展，灰青柔光，不用琥珀和霓虹。
动效专业、稳定：21–30f揭示，不手持、不逐拍震屏。物理飞入保留卡片规定过冲。品牌hold≥30f。
styleframes.html三张静态构图先于视频实现。

## 功能到镜头映射
|功能|选用卡/变体|备选|理由|
|---|---|---|---|
|品牌|blur-slide / blur-slide|brand-ink-open|中文3–5语义组，三通道同p|
|规则管理|crane-rise-reveal / crane-rise-reveal|cursor-flyover|细节到全局，24f特写+102f拉升|
|AI引擎|自定义水平PageCam特写|integration-hub-map|表格字段真实，不虚构中枢页|
|定时任务|row-embed / row-embed|list-stack-press|真实行嵌回槽位|
|监控和趋势|自定义焦点取景|chart-live-moves|直接展示原生问答和曲线|
|收束|outro-group-photo-launch / 同名|无|各功能代表图四方归拢|
准确demo、卡与索引在reference/。自定义范围仅真实截图取景和字幕；风险为小字可读性，使用2x全页+4x特写和逐镜静帧检查。

## 最终分镜（采集前自主放行）
拍号由analysis/beat_data.json换算，约40秒。切点用beatF。关键信息落定≥30f。
|#|拍区间|页面和文案|动效、转场、声音|
|---|---|---|---|
|1|0–8|WorkTool Console；让企微协作，自动运转|blur-slide，主角动作≥3秒，轻whoosh|
|2|8–20|机器人配置；机器人与回复规则，统一管理|24f特写，102f拉升，≥30fhold；不虚构渲染状态翻转|
|3|20–32|AI引擎；连接AI，让回复更有章法|水平侧向回正，OpenAI兼容/FastGPT/OpenClaw，落拍硬切|
|4|32–36|把重复操作，交给自动化|短字卡，线条展开，轻过渡|
|5|36–48|定时任务；设好时间，任务按计划执行|cue12/22/31/39/46，fly12f，真实槽位归位|
|6|48–60|消息监控；从问题到回答，每一步都有记录|定机位焦点揭示，虚构问答，无虚构点击|
|7|60–68|趋势；消息趋势，一眼掌握|真实图表轻推，明确演示数据|
|8|68–80|五功能截图围住WorkTool；让团队专注更重要的事；console.worktool.ymdyes.cn|四方飞入、4°crane、42f字标压印、≥30fhold；riser→impact→sparkle|

数据：机器人「演示·客服助手/运营助手/团队助手」，演示群与访客编号，example.com地址，统计仅虚构演示。凭据不落盘、不入素材。

## 实测后的执行记录
音乐：House Vibez / Lily J / Mixkit 745，使用首8小节稳定段循环；非变速。原音乐稳定段相位0.083504秒，周期0.491833秒，122 BPM。网格命中100%，平均误差1.76ms，最大9.68ms。完整曲中段有breakdown，因此选稳定段，分析保留在analysis/。
渲染管线实测：Remotion4.0.484、AAC48kHz、MP4，BGM交叉相关输出滞后2048samples=1.28f；transition / swoosh / impact三探针一致。视觉切点整体加1.28f后取整，SFX起点扣1.28f及各自峰值滞后；源音乐相位不改。见audio-qa-before-compensation.json与最终回测。
构图适配：无真实渲染队列的状态翻转，不给机器人规则虚构状态；crane保留24f细节hold、102f同p焦点与zoom拉升、末端hold。行嵌入保留12/22/31/39/46 cue和12f飞行，色缝改为品牌灰青。片尾由五个核心功能卡构成合影（覆盖全部功能），保留飞入12f、y1=1.4过冲、42f退后排、4°crane、逐字压印与长hold。
自主品牌适配的明确偏差：crane采用整体焦点揭示，省去逐行洗光；片尾保留核心飞入/过冲/crane/压印时值，省去开场光带、方向性速度模糊与延长线，以匹配产品克制的视觉方向。本片为卡片动作语法的品牌适配，不主张完整复刻参考片。
