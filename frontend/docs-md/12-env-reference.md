# 环境变量参考

本页对照仓库根目录 `.env.example` 与 `docker-compose.yml`。表中的“示例值”来自示例配置，不保证等于直接运行 Python 时的示例值。真实密钥不要提交到代码仓库。修改环境变量后重新创建相关容器。

手机上可左右滑动表格查看全部列。

字段约定：

- 必填：`是` 表示生产必须配置；`否` 表示可使用示例值或留空
- 敏感：`是` 表示包含密钥/口令，禁止泄露

## Core

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `PYTHONUNBUFFERED` | `1` | 否 | 否 | Python 日志实时输出。 |
| `WEB_PORT` | `18080` | 否 | 否 | 对外 Web 端口。 |
| `APP_DEPLOYMENT_MODE` | `private` | 是 | 否 | 部署模式：源码/私有化使用 `private`，官方公版使用 `saas`。SaaS 出站 URL 仅允许解析到公网 IP。 |
| `PRIVATE_OUTBOUND_ALLOW_LOOPBACK` | `false` | 否 | 否 | 私有化模式是否允许访问回环地址；仅在明确需要访问同容器服务时开启。 |

## MySQL（容器）

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `MYSQL_ROOT_PASSWORD` | `change_me_root` | 是 | 是 | MySQL root 密码。 |
| `MYSQL_DATABASE` | `worktool_bridge` | 否 | 否 | 初始化数据库名。 |
| `MYSQL_USER` | `worktool` | 否 | 否 | 业务账号用户名。 |
| `MYSQL_PASSWORD` | `change_me_app` | 是 | 是 | 业务账号密码。 |

## App MySQL（后端连接）

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `APP_MYSQL_HOST` | `mysql` | 是 | 否 | 后端连接 MySQL 的地址。 |
| `APP_MYSQL_PORT` | `3306` | 否 | 否 | 后端连接 MySQL 端口。 |
| `APP_MYSQL_USER` | `worktool` | 是 | 否 | 后端数据库账号。 |
| `APP_MYSQL_PASSWORD` | `change_me_app` | 是 | 是 | 后端数据库密码，使用内置 MySQL 时与 MYSQL_PASSWORD 一致。 |
| `APP_MYSQL_DATABASE` | `worktool_bridge` | 是 | 否 | 后端数据库名。 |
| `APP_MYSQL_TIME_ZONE` | `+08:00` | 否 | 否 | MySQL 会话时区。 |

## 认证与平台功能

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `AUTH_JWT_SECRET` | `change_me_to_random_32_plus_chars` | 是 | 是 | JWT 签名密钥，需高强度随机。 |
| `AUTH_JWT_EXPIRE_DAYS` | `30` | 否 | 否 | 登录态有效天数。 |
| `AUTH_PBKDF2_ITERATIONS` | `390000` | 否 | 否 | 密码哈希迭代次数。 |
| `AUTH_SMS_ENABLED` | `false` | 否 | 否 | 是否启用短信注册/找回。 |
| `PRIVATE_ADMIN_USERNAME` | `admin` | Private 是 | 否 | Private 首次启动自动创建的管理员账号。 |
| `PRIVATE_ADMIN_PASSWORD` | `123456` | Private 是 | 是 | Private 管理员初始密码，至少 6 位且登录后可修改；首次创建后不会在重启时覆盖数据库密码，SaaS 模式不生效。 |
| `PRIVATE_SELF_REGISTRATION_ENABLED` | `false` | 否 | 否 | 是否允许 Private 用户自助注册；交付客户时建议关闭，由管理员创建账号。 |
| `ENABLE_RUNTIME_WORKTOOL_SETTINGS` | `false` | 否 | 否 | 是否开放运行时修改 WorkTool 基础配置。 |
| `WORKTOOL_API_BASE` | `http://host.docker.internal:15080` | 否 | 否 | WorkTool API 基础地址；示例访问宿主机网关，远程部署应替换为实际 HTTPS 地址。 |
| `CALLBACK_PUBLIC_BASE_URL` | `http://YOUR_PUBLIC_IP:18080` | 否 | 否 | 平台回调地址前缀，替换成发送方可访问的真实地址。 |
| `ADMIN_PHONE_WHITELIST` | 空 | 视情况 | 否 | 管理员手机号白名单，逗号分隔。 |
| `DEMO_ROBOT_IDS` | 空 | 否 | 否 | 演示机器人 ID 列表（逗号分隔）；当前 Compose 对空值也回退为 worktool1。普通用户限制改配置，但仍可测试下发指令。 |
| `ENABLE_ADMIN_IP_BLACKLIST` | `false` | 否 | 否 | 是否显示“黑名单管理”模块。 |
| `ENABLE_ADMIN_ENTERPRISE_AUTH` | `false` | 否 | 否 | 是否显示“企业定制开通”模块。 |
| `PRIVATE_LICENSE_SECRET_KEY` | 空 | 生成 V1 授权时是 | 是 | V1 AES License 生成密钥，必须保持 16 字节且不得进入 Git 或前端构建。 |
| `PRIVATE_LICENSE_V2_PRIVATE_KEY_BASE64` | 空 | 生成 V2 授权时是 | 是 | lic2 PKCS#8 PEM 私钥的单行 Base64，仅配置在 SaaS 后端运行环境，不得进入 Git、前端构建或客户部署包。 |
| `ENABLE_OPEN_TROUBLESHOOT_API` | `false` | 否 | 否 | 是否开启开放排查 API。 |
| `OPEN_TROUBLESHOOT_API_KEY` | 空 | 开启时是 | 是 | 开放排查 API 的访问密钥。 |
| `OPEN_TROUBLESHOOT_ALLOWED_ROBOT_IDS` | 空 | 否 | 否 | 开放排查 API 允许查询的机器人范围。 |

## WorkTool 扩展接口路径（可选）

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `WORKTOOL_IPACL_QUERY_PATH` | 空 | 黑名单功能开启时是 | 否 | 黑名单查询接口 path。 |
| `WORKTOOL_IPACL_ADD_PATH` | 空 | 黑名单功能开启时是 | 否 | 黑名单新增接口 path。 |
| `WORKTOOL_IPACL_DELETE_PATH` | 空 | 黑名单功能开启时是 | 否 | 黑名单删除接口 path。 |
| `WORKTOOL_WEWORK_AUTH_LIST_PATH` | 空 | 企业授权功能开启时是 | 否 | 企业授权列表接口 path。 |
| `WORKTOOL_WEWORK_AUTH_SAVE_PATH` | 空 | 企业授权功能开启时是 | 否 | 企业授权保存接口 path。 |
| `WORKTOOL_WEWORK_AUTH_DELETE_PATH` | 空 | 企业授权功能开启时是 | 否 | 企业授权删除接口 path。 |
| `WORKTOOL_DB_HOST` | 空 | 否 | 否 | WorkTool DB 连接地址。 |
| `WORKTOOL_DB_PORT` | `3306` | 否 | 否 | WorkTool DB 端口。 |
| `WORKTOOL_DB_USER` | 空 | 否 | 否 | WorkTool DB 用户名。 |
| `WORKTOOL_DB_PASSWORD` | 空 | 否 | 是 | WorkTool DB 密码。 |
| `WORKTOOL_DB_NAME` | 空 | 否 | 否 | WorkTool DB 库名。 |

## 短信（华瑞）

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `SMS_HUARUI_API_URL` | 空 | 短信开启时是 | 否 | 短信服务地址。 |
| `SMS_HUARUI_APPKEY` | 空 | 短信开启时是 | 是 | 短信 appkey。 |
| `SMS_HUARUI_APPSECRET` | 空 | 短信开启时是 | 是 | 短信 appsecret。 |
| `SMS_CODE_EXPIRE_MINUTES` | `15` | 否 | 否 | 短信验证码有效期（分钟）。 |

## 默认测试引擎与回调并发

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `DEFAULT_TEST_PROVIDER_ENABLED` | `false` | 否 | 否 | 是否启用系统级测试 AI 引擎。 |
| `DEFAULT_TEST_PROVIDER_NAME` | `AI模型(仅测试用)` | 否 | 否 | 测试引擎名称。 |
| `DEFAULT_TEST_PROVIDER_BASE_URL` | `https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions` | 开启时是 | 否 | 测试引擎地址。 |
| `DEFAULT_TEST_PROVIDER_API_KEY` | 空 | 开启时是 | 是 | 测试引擎 token。 |
| `DEFAULT_TEST_PROVIDER_MODEL` | `doubao-seed-2.0-lite` | 否 | 否 | 测试引擎 model。 |
| `GROUP_DECISION_PROVIDER_BASE_URL` | 空 | 使用官方群聊判定时是 | 否 | 官方“是否需要回复”判定引擎地址，与测试回复引擎独立。 |
| `GROUP_DECISION_PROVIDER_API_KEY` | 空 | 使用官方群聊判定时是 | 是 | 官方判定引擎 token。 |
| `GROUP_DECISION_PROVIDER_MODEL` | 空 | 使用官方群聊判定时是 | 否 | 官方判定引擎 model。机器人留空选择时使用此配置，数据库不保存引擎 ID。 |
| `QA_CALLBACK_WORKER_CONCURRENCY` | `16` | 否 | 否 | QA 回调异步 worker 数。 |
| `QA_CALLBACK_QUEUE_MAXSIZE` | `2000` | 否 | 否 | QA 回调队列长度。 |
| `ROBOT_SHOW_NAME_CACHE_TTL_SECONDS` | `600` | 否 | 否 | 机器人昵称缓存秒数。 |

## 对话上下文记忆（轻量）

| 变量 | 示例值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `CHAT_CONTEXT_ENABLED` | `true` | 否 | 否 | 是否启用群聊/私聊上下文记忆。 |
| `CHAT_CONTEXT_MAX_MESSAGES` | `20` | 否 | 否 | 回复时单会话最多读取的上下文消息数。 |
| `CHAT_CONTEXT_RETENTION_DAYS` | `15` | 否 | 否 | 上下文数据保留天数。 |
| `QA_MONITOR_RETENTION_DAYS` | `15` | 否 | 否 | 消息监控记录保留天数。 |
| `MESSAGE_LOG_RETENTION_DAYS` | `15` | 否 | 否 | 收发消息日志保留天数。 |
| `LOG_CLEANUP_BATCH_SIZE` | `5000` | 否 | 否 | 调度器每轮清理每张日志表的最大行数。 |

## 补充配置

以下参数也由当前部署使用，空值表示未配置或不启用相应可选能力。

| 变量 | 示例值 | 说明 |
| --- | --- | --- |
| `WEB_BIND_IP` | `0.0.0.0` | Web 端口绑定地址；只经本机反向代理访问时可绑定 127.0.0.1。 |
| `WORKTOOL_API_FALLBACK_BASE` | 空 | 可选备用 WorkTool 地址；留空维持单地址行为，不代表所有写操作会自动重试。 |
| `WORKTOOL_RENEW_TOKEN` | 空 | 机器人续期等管理接口凭证，按所接服务配置。 |
| `APP_PUBLIC_BASE_URL` | `http://YOUR_PUBLIC_IP:18080` | 平台公开访问地址，用于生成公开链接，需改成真实地址。 |
| `AI_PROVIDER_TIMEOUT_SECONDS` | `60` | AI 接口超时秒数。 |
| `FEEDBACK_WECOM_WEBHOOK_URL` | 空 | 建议与反馈通知的企微群机器人 webhook，仅后端使用；留空不发送。 |

## Compose 中的其他参数

这些参数未全部列入 `.env.example`，可按需在 `.env` 配置。

| 变量 | Compose 默认值 | 说明 |
| --- | --- | --- |
| `ENABLE_TROUBLESHOOT` | `false` | 内部机器人排查能力开关，与开放排查 API 开关分开。 |
| `APP_UPLOAD_DIR` | `/data/uploads` | 容器上传目录，默认映射仓库 uploads/。 |
| `SMS_HUARUI_SIGN` | `【南京亚美达科技】` | 短信签名，应替换为服务商审批通过的实际签名。 |
| `SCHEDULER_POLL_SECONDS` | `2` | 调度器轮询间隔秒数。 |
| `SCHEDULER_BATCH_LIMIT` | `20` | 调度批量上限。 |
| `VITE_ANALYTICS_ENABLED` | `false` | 前端统计开关，构建时生效。 |
| `VITE_ANALYTICS_URL` | `https://analytics.ymdyes.cn` | 统计服务地址，按自己的部署配置。 |
| `VITE_ANALYTICS_WEBSITE_ID` | 空 | 统计站点标识。 |

WorkTool 数据库配置用于需要直查其数据的管理能力，不能拿 Console 的 APP_MYSQL 配置替代。没有启用相应功能时无需填写。

## 生产建议

1. `AUTH_JWT_SECRET`、`MYSQL_PASSWORD`、`APP_MYSQL_PASSWORD`、各类 `*_KEY/*_SECRET` 必须替换成强随机值。
2. Private 交付建议保持 `PRIVATE_SELF_REGISTRATION_ENABLED=false`，由管理员统一创建账号。
3. 开源场景建议默认关闭：`ENABLE_ADMIN_IP_BLACKLIST`、`ENABLE_ADMIN_ENTERPRISE_AUTH`、`ENABLE_OPEN_TROUBLESHOOT_API`。
4. 小流量先用：`QA_CALLBACK_WORKER_CONCURRENCY=8~16`；高峰再按监控调优。
5. 上下文记忆建议保持轻量：`CHAT_CONTEXT_MAX_MESSAGES=20`、`CHAT_CONTEXT_RETENTION_DAYS=15`。
