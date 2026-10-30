# 模拟客户端可选模块

## 边界

- `frontend/src/pages/MockClientPage.tsx`：Console 原生 React/Ant Design 页面，仅管理员可见，SaaS/私有化均支持。
- `frontend/src/mockClientApi.ts`：管理接口与增量记录模型，复用 Console Axios 登录凭证。
- `backend/mock_client.py`：独立 FastAPI 适配器，复用 `get_current_user` / `_require_admin`；仅转发已列出的操作，不实现协议，不读写业务表。
- `services/mock-client/`：独立 Node 引擎，自己管理内存会话、WS、队列、回调和场景；保留独立页面、CLI、测试，无 Python/数据库依赖。协议后续在此目录维护。
- `main.py` 只有模块安装与 health 功能标志；引擎不可用返回503，不影响其他业务模块。仅部署一份引擎，不做负载均衡。

Node 的 `X-Mock-Service-Key` 是模块内部共享密钥，**不是** Console JWT密钥或用户Token。
Console 校验登录和管理员身份后，将真实用户ID注入 `X-Mock-User`。Node校验服务密钥、按用户隔离会话。
浏览器不能决定上游服务地址或伪造用户身份。测试目标的WS/HTTP地址属于管理员模拟功能本身，勿开放给普通用户。

## 本地开发

终端一（Node >=20）：

```sh
cd services/mock-client
npm ci
PORT=8788 MOCK_CLIENT_SERVICE_KEY='<本地随机密钥，至少16字符>' npm start
```

终端二（原 Console Python 环境、原数据库配置）：

```sh
export ENABLE_MOCK_CLIENT=true
export MOCK_CLIENT_URL=http://127.0.0.1:8788
export MOCK_CLIENT_SERVICE_KEY='<与上面相同>'
export MOCK_CLIENT_PUBLIC_BASE_URL=http://127.0.0.1:5173
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000
```

终端三：`cd frontend && npm run dev`，管理员登录后菜单进入“模拟客户端”。
新建会话 → 启动本地演示 → 下发演示任务 / 运行场景。真实测试填写机器人ID；页面读取 Console `/settings/worktool` 的生效 `worktool_api_base`，自动转换为对应的 `ws://` 或 `wss://` `/webserver/wework/{robotId}` 地址。
页面离开或隐藏后停止轮询；后台继续连接，默认30分钟无管理请求清理，场景运行期间保留。
同一管理员可切换多个会话，不同管理员互不可读取；服务总上限默认4个。令牌不进入浏览器持久化配置。

## Docker 部署

生成随机共享密钥，写入部署 `.env`：

```sh
openssl rand -hex 32
```

设置 `MOCK_CLIENT_SERVICE_KEY` 和 `MOCK_CLIENT_PUBLIC_BASE_URL=https://你的Console域名`，然后：

```sh
docker compose -f docker-compose.yml -f docker-compose.mock-client.yml up -d --build
```

附加 Compose 文件才会启用模块。原 Compose 不增加服务、不启用入口，也不要求配置密钥。
Node容器监听0.0.0.0但不发布宿主机端口，只有内部服务可以访问。后台负责认证，Node也校验共享密钥。
原有 Nginx `/api/` 转发即可，无需新增公开端口。内置模拟回调使用本机收发，不依赖公网回环。
`MOCK_CLIENT_PUBLIC_BASE_URL` 显式配置可避免多层代理错误生成http回调地址；不配置则使用请求base URL。

关闭功能：恢复仅使用原 Compose 并重建backend，然后停止/移除mock-client服务。所有会话为临时内存，无数据库迁移或业务数据清理。
在普通进程部署中，设置 `ENABLE_MOCK_CLIENT=false` 并重启Console即可关闭入口和接口。
如需物理删除插件代码，先移除main.py的import、install、health标志以及App.tsx的菜单路由引用，再移除目录；“关闭功能”无需删代码。

## 接口约定

管理入口均为 `/api/v1/admin/mock-client`，要求已有Console Bearer Token及管理员权限：

- `GET /sessions`：仅当前用户会话列表。
- `POST /sessions`：创建会话。
- `GET /sessions/{id}/state?epoch=...&after=...&callbackAfter=...`：增量日志、回调、状态。
- `POST /sessions/{id}/connect|stop|delete|action|rules|demo-command`：连接及控制。
- `POST /sessions/{id}/scenario-start`：立即返回202与runId，不等待场景结束。
- `GET /sessions/{id}/scenario-status`：运行状态/最终报告；state也带最新运行信息。
- `GET /sessions/{id}/export`：导出仍保留的记录。

测试接收入口独立为 `POST /api/v1/mock-client/callbacks/{随机令牌}`，不要求用户登录，仅匹配仍有效的模拟会话；请求最大1MiB。
其数据仅进入模拟器缓存，绝不路由到生产 `/callback/qa/`，不触发Console正式事件任务。会话清理/引擎重启后旧地址404。
每会话缓存上限：协议4MiB、回调8MiB、演示记录2MiB（按JSON字节计）。这些不是进程总内存限额。

## 自测

```sh
(cd services/mock-client && npm ci && npm test && npm run scenario -- --demo)
(cd backend && python -m unittest test_mock_client)
(cd frontend && npm test -- src/mockClientApi.test.ts && npm run build)
```

真实 Java 后端需要单独联调；本地演示通过不代表真实后端回归通过。

### 本次本地验收（2026-10-30）

- Node 引擎：26项通过，含服务密钥、用户隔离、异步场景、停止、缓存和回执。
- 前端：64项通过，TypeScript检查及生产构建通过，包含从Console有效baseurl生成WebSocket地址的测试。
- Python相关测试：77项中56项通过，21项依赖数据库的集成测试按原条件跳过；新增7项全部通过。
- 实际 `main.app`：功能关闭返回404；引擎不可用返回503，同时health仍正常。
- 浏览器：使用本地测试身份和真实Node引擎，验证管理员入口、新建/切换/关闭会话、演示任务、执行回执、HTTP事件回调、暂停恢复及场景通过。
- Compose合并配置校验通过，未部署生产模拟器服务。
- 经授权使用测试机器人完成真实后端短连接：收到202、503，确认接收并上报503、506；未收到用户业务指令，结束后确认机器人离线。此次只验证连接及初始化，未覆盖真实后端业务任务和心跳长连。
- 普通连接会更新后端机器人在线状态和初始化资料；本次503上报使测试机器人的名称、企业显示为“模拟机器人 / 模拟企业”，App显示为MockClient。真实联调应使用测试机器人。
