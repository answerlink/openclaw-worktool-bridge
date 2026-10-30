# WorkTool 协议模拟客户端

无需安卓手机。Node.js 负责 WebSocket / 心跳 / 队列 / HTTP 回调，HTML 负责操作和观察。
工具独立于 Android、Java 后端构建，不改业务代码。Node.js >=20。

## 启动网页

```sh
cd tools/mock-client
npm ci
npm start
```

打开 http://127.0.0.1:8787 ，点击「启动本地演示」即可使用，无需真实机器人。
演示会启动本地协议对端，自动下发503；可下发203、218等任务、上报读屏、设置失败规则、暂停、断线重连、执行场景。

连接真实测试后端：填写完整 WebSocket URL（部署可能带 `/api` 前缀）、测试机器人 ID、key 查询参数和可选 token。
安装实例 ID 保持不变可模拟同设备重连；换值可测试异设备登录。旧客户端身份可留空。
操作会真实改变测试后端的数据及触发其回调，请使用专门的测试机器人。
页面默认仅绑定127.0.0.1；远程测试机可以使用 SSH 转发，或按下文通过管理后台反向代理。
每个页面会话独立持有机器人连接、规则、日志和回调地址；「另开独立会话」可并行测试第二个机器人。刷新页面保留当前会话，服务重启后需新建。

## 长期运行 / 管理后台集成

不新增数据库或 Redis。一个 Node 服务默认最多4个页面会话，适合偶尔1～2个并发连接。

| 项目 | 默认策略 |
|---|---|
| 协议日志 | 每会话最多2000条 / 4 MiB UTF-8 JSON |
| HTTP回调 | 每会话最多1000条 / 8 MiB UTF-8 JSON；单次请求最多1 MiB |
| 演示后端日志 | 每会话最多2000条 / 2 MiB UTF-8 JSON |
| 演示待回执关联 | 最多1000项，完成后删除，未完成30分钟过期，每分钟清理 |
| 页面刷新 | 可见时每秒获取增量，隐藏时暂停；机器人心跳和任务继续运行 |
| 增量响应 | 每次最多150条日志、20条回调，两类各256 KiB预算；超过64 KiB的单条显示预览 |
| 页面展示 | 最近150条日志、100条回调；手动导出获取服务端仍保留的完整记录 |
| 会话清理 | 页面关闭/隐藏后30分钟没有管理请求则清理（每分钟检查）；正在运行的场景不清理 |

上述容量是序列化内容大小，不等于进程总内存。Node基础内存、JS对象、任务队列和瞬时请求另计；没有持续落盘日志。
页面持续打开会保持会话；仅有心跳或外部回调不会延长无人使用会话的寿命。需要长期无人值守连接可调大超时，或使用CLI。

本地启动方式不变。部署示例（替换为你的管理后台地址）：

```sh
PUBLIC_URL=https://test.example.com/mock-client/ \
TRUST_PROXY_AUTH=1 \
MAX_SESSIONS=4 \
SESSION_IDLE_MINUTES=30 \
npm start
```

- `PORT` 默认8787，始终监听127.0.0.1，由同机管理后台/网关反向代理。
- `PUBLIC_URL` 是浏览器访问的页面根地址，可以带子路径，页面地址需以 `/` 结尾。
- `MAX_SESSIONS` 为整个服务的会话上限（包括尚未连接的页面），可设1～20。
- `SESSION_IDLE_MINUTES=0` 关闭自动回收；默认30分钟。
- 本机模式无需认证。配置 `PUBLIC_URL` 后，所有管理请求必须有网关提供的 `X-Mock-User`，不同用户的会话互不可读写。
- `TRUST_PROXY_AUTH=1` 表示信任**同机已认证代理**，它本身不是登录验证。代理必须验证现有管理后台登录、覆盖用户传来的同名请求头，再填入稳定用户ID；不可直接透传浏览器提交的身份。

反向代理接入约定：

1. `/mock-client/` 及其 `/api/` 路由：验证管理后台登录，再代理到 `http://127.0.0.1:8787/`，去掉 `/mock-client/` 前缀。设置 `Host: 127.0.0.1:8787`、`X-Mock-User: 已认证用户ID`，保留原始 Origin。页面使用相对路径，支持子目录。
2. `/mock-client/callbacks/<随机令牌>`：仅POST，不要求管理后台登录，代理到对应 `/callbacks/<随机令牌>`。这是给被测后端投递回调用的独立地址，单次请求体限制设1 MiB；令牌不能固定或被代理抹掉。
3. 页面显示的回调地址使用 `PUBLIC_URL`，可复制到测试后端的回调配置；模拟器内部演示/默认事件投递走本机地址，不依赖外网回环。
4. 场景请求需要等待执行完毕，代理读取超时需覆盖测试场景时长；普通操作仍为短请求。
5. 若用iframe集成，保持同源并让代理沿用后台登录。工具本身不新增账号系统。

每个会话的回调地址不同，删除、超时清理或服务重启后旧地址返回404。测试人员在页面关闭会话即可释放连接；无需重启整个服务。
网页控制API已调整为 `/api/sessions/<id>/...`，旧单会话 `/api/connect` 等路径不再使用；CLI入口与WorkTool协议保持不变。

## CI

```sh
./ci.sh
# 或分别运行
npm test
npm run scenario -- --demo --report reports/smoke.json
```

第一条测试模拟器本身；第二条跑本地演示端到端场景。**演示对端不是 Java 后端，不能据此宣称生产后端回归通过。**
退出码0通过，1失败。报告包含断言、双向报文、回调和指标，可作为CI artifact。
可用 `node --test --test-reporter=junit > reports/tests.xml` 输出 JUnit（先创建 reports）。

### 接真实 Java 后端

1. 预先创建专用测试机器人，不自动修改数据库或回调绑定。
2. 复制 `config.example.json` 为 `config.local.json`，修改 URL / robotId / clientInstanceId。
   需要 token 时可填 `"token":"${env.MOCK_TOKEN}"`，避免提交凭证。URL 中的 key 同理。
3. 设置真实下发接口，运行场景：

```sh
export MOCK_COMMAND_URL='http://127.0.0.1:8081/robot/wework/sendRawMessage?robotId=mock-test-robot&key=test-key'
npm run scenario -- --config config.local.json --scenario scenarios/backend-smoke.json
```

此场景使用已核对的后端协议：POST body `{"socketType":2,"list":[...]}`；响应 `data` 是 messageId 字符串。
它断言该ID的接收确认和执行结果确实在WebSocket上发送。数据库是否入库需后端额外查询断言。

### 验证后端真正投递执行结果回调

先将测试机器人“指令执行结果回调”配置到 `http://127.0.0.1:8790/callback`，然后：

```sh
npm run scenario -- --config config.local.json --callback-port 8790 --scenario scenarios/backend-callback.json
```

该场景必须收到 Java 后端发来的 HTTP 回调才通过。回调接收器仅监听本机；后端不在同机时需端口转发。
CLI会打印报告路径，回调地址可在配置中使用 `${callbackUrl}`。不会替你覆盖已有机器人配置。

## 拟真范围和源码依据

| 行为 | 实现 / 对应源码 |
|---|---|
| 握手 | `appVersion`、可选token请求头，`clientInstanceId`查询参数；`WebSocketManager.connect` |
| 心跳 | 默认5秒 `{"type":11}`，每5分钟可附加简化健康信息；不是socketType=11 |
| 接收确认 | socketType=1，原messageId；重复包仍确认，但不重复执行；最近10000个ID |
| 业务上报 | socketType=2，例如101读屏、301连接日志、501群信息、503我的信息、506企业列表 |
| 执行回执 | socketType=3；type=0、rawMsg字符串、errorCode、errorReason、runTime毫秒、timeCost秒、successList/failList；`GlobalMethod.uploadCommandResult` |
| 队列 | 串行执行，up和226插队不抢占执行中任务；同一包多个子指令保留相同ID |
| 即时队列操作 | 304清空、305按originalContent取消、306查询；只处理待执行项；取消回执101018 |
| 202/307/102 | 启动读屏循环 / 按configUrl刷新配置 / 记录通知，不冒充普通成功回执 |
| 501 | selectList逐群上报501，沿用查询ID；当前客户端没有额外执行成功回执 |
| 503 | 模拟个人与企业资料上报，不制造执行回执 |
| 512 | 501数据上报＋异步HTTP成员事件＋执行回执，三条独立路径 |
| 308/514 | 独立于RPA串行队列；308返回虚拟本地路径，514返回gzip+base64合成日志并限制同时采集 |
| 常用业务指令 | 201/203/204/205/206/207/218/224/226按规则模拟结果；206/207更新模拟群资料 |
| 事件 | 直接HTTP POST，X-查询参数转换请求头，event_token保留；108/109随手动暂停恢复产生 |
| 重连 | 断线后固定间隔重连；保留内存队列、去重ID、离线待上传数据；旧连接回调隔离 |
| 加密 | AES-128-CBC / PKCS padding / HEX，使用当前客户端协议常量 |

对照文件：客户端 `utils/WebSocketManager.java`、`service/MyLooper.kt`、`model/CustomMessageQueue.kt`、`service/GlobalMethod.kt`、`service/WeworkGetImpl.kt`、`utils/HttpUtil.kt`。
后端 `/Users/jialun/develop/worktool_backend` 中 `server/WeworkWebSocketServer.java`、`WeworkEventProcessor`、`RawConfirmEventListener`、`GroupInfoEventListener`、`WeworkServiceImpl.sendRawMessage`。

## 执行规则

规则按数组顺序匹配，可限定 `type`、`messageId`、`target`（titleList成员或groupName）。

```json
[
  {"type":218,"delayMs":15000},
  {"type":203,"target":"失败群","errorCode":201101,"errorReason":"发送前房间校验失败(输入前)","failList":["失败群"]},
  {"type":203,"target":"部分成功","successList":["群A"],"failList":["群B"]},
  {"type":207,"dropResult":true}
]
```

`dropResult`模拟执行后无结果，队列继续；用较大delayMs模拟长任务积压。
未实现指令返回101012，不默认为成功。需要扩展时用：

```json
{"type":999,"mode":"custom","delayMs":500,"uploads":[{"type":501,"groupName":"模拟群"}],"errorCode":0}
```

这里是显式合成行为；`uploads`用当前任务ID，`callback`可发送事件，再返回结果。
`duplicationFilter`默认关闭，以便稳定测试同内容多任务；开启后按待执行内容去重并回101014。

## 场景格式

`steps`顺序执行。`atMs`相对于场景开始时间；`speed`仅缩放动作时间线和wait，执行耗时由rules独立控制。
动作：screen、upload、event、pause、resume、disconnect、heartbeat、config、wait、http、assert。

- `http`支持method、headers、body、status、expect（JSON点路径字段断言）、saveAs。
- `${task.data}`引用之前请求保存的响应，关联本次真实ID；`${env.NAME}`仅CLI可用。
- `assert`默认检查本场景开始后的模拟器trace；`source:"callbacks"`检查本地HTTP接收记录。
- `match`是点路径精确匹配；`count`默认1，`exact:true`要求当下数量精确相等。
- 检查不应发生的事情：先wait经过观察窗口，再用count=0、exact=true断言；不是永久保证。
- trace最多2000条 / 4 MiB JSON，HTTP接收最多1000条 / 8 MiB JSON；任一上限先到就淘汰最早记录。单条trace超过容量仅保留说明，断言不会伪造成功。队列最多10000项，过长场景应分拆。

## 导入客户端日志

```sh
npm run import-log -- /path/client.txt imported.local.json
```

流式读取，识别 `onMessage: {...}` 下发及 `args[1] = {...}` 上报，处理跨午夜时间。
输出 `scenario`（时间线）和 `executionSamples`（原任务耗时/结果），默认用稳定匿名名称替换业务字符串，不提交真实客户日志。

下发旧ID不会直接重用：通过 HTTP 下发新任务，把响应保存在taskN。输出样本引用 `${taskN.data.messageId}`。
默认导入下发格式适用于演示后端 `/send`，设置commandUrl；真实后端将引用改为 `${taskN.data}`。
导入产物需取出scenario字段作为场景文件；执行样本按type/target整理到配置rules。不会将历史结果直接伪装成本次收到的指令。
不导入独立HTTP事件、加密包、未知任务，也不把日志文字当作执行指令。Base64内容和下载URL移除，文件发送为模拟执行。

## 明确边界

- 模拟协议与业务结果，不执行Android RPA、企微真实发消息或真实下载。
- 延迟固定/可配置，不宣称准确模拟每个机型耗时；截图、OCR、节点树及UI失败由规则表达。
- 不完整复制Android崩溃后的磁盘队列恢复、结果延迟清理、无限读屏循环、自动重登录/TLS降级。进程退出内存状态丢失。
- HTTP不自动重试；401等失败记录在时间线。token由配置提供；不自动登录账号。
- 读屏在暂停/执行中跳过，产生screenSkipped；回放不保证每个时间点都能读屏。
- 真实后端上线校验、不同设备踢出、数据库/Redis竞争必须连接真实后端验证；演示端不实现这些后端逻辑。
- 日志导入是可审阅的场景草稿，不是无人工参与的任意日志完整复刻。

## Console 集成版

此目录是 Console 使用的独立模拟引擎，后续协议功能在此维护。
初始来源为 Android 仓库的 `tools/mock-client`，包含 2026-10-30 的缓存和会话改进。
不依赖 Console Python 模块、业务数据库或登录密钥，保留独立网页与 CLI。
管理后台接入说明见 `docs/mock-client-integration.md`。
