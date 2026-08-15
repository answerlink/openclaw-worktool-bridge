# 环境变量参考

本页对应仓库根目录 `.env.example`。建议生产环境按需覆盖，不要把真实密钥提交到代码仓库。

字段约定：

- 必填：`是` 表示生产必须配置；`否` 表示可使用默认值或留空
- 敏感：`是` 表示包含密钥/口令，禁止泄露

## Core

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `PYTHONUNBUFFERED` | `1` | 否 | 否 | Python 日志实时输出。 |
| `WEB_PORT` | `8080` | 否 | 否 | 对外 Web 端口。 |
| `APP_DEPLOYMENT_MODE` | `private` | 是 | 否 | 部署模式：源码/私有化使用 `private`，官方公版使用 `saas`。SaaS 出站 URL 仅允许解析到公网 IP。 |
| `PRIVATE_OUTBOUND_ALLOW_LOOPBACK` | `false` | 否 | 否 | 私有化模式是否允许访问回环地址；仅在明确需要访问同容器服务时开启。 |

## MySQL（容器）

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `MYSQL_ROOT_PASSWORD` | `change_me_root` | 是 | 是 | MySQL root 密码。 |
| `MYSQL_DATABASE` | `worktool_bridge` | 否 | 否 | 初始化数据库名。 |
| `MYSQL_USER` | `worktool` | 否 | 否 | 业务账号用户名。 |
| `MYSQL_PASSWORD` | `change_me_app` | 是 | 是 | 业务账号密码。 |

## App MySQL（后端连接）

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `APP_MYSQL_HOST` | `mysql` | 是 | 否 | 后端连接 MySQL 的地址。 |
| `APP_MYSQL_PORT` | `3306` | 否 | 否 | 后端连接 MySQL 端口。 |
| `APP_MYSQL_USER` | `worktool` | 是 | 否 | 后端数据库账号。 |
| `APP_MYSQL_PASSWORD` | `change_me_app` | 是 | 是 | 后端数据库密码。 |
| `APP_MYSQL_DATABASE` | `worktool_bridge` | 是 | 否 | 后端数据库名。 |
| `APP_MYSQL_TIME_ZONE` | `+08:00` | 否 | 否 | MySQL 会话时区。 |

## 认证与平台功能

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `AUTH_JWT_SECRET` | `change_me_to_random_32_plus_chars` | 是 | 是 | JWT 签名密钥，需高强度随机。 |
| `AUTH_JWT_EXPIRE_DAYS` | `30` | 否 | 否 | 登录态有效天数。 |
| `AUTH_PBKDF2_ITERATIONS` | `390000` | 否 | 否 | 密码哈希迭代次数。 |
| `AUTH_SMS_ENABLED` | `false` | 否 | 否 | 是否启用短信注册/找回。 |
| `ENABLE_RUNTIME_WORKTOOL_SETTINGS` | `false` | 否 | 否 | 是否开放运行时修改 WorkTool 基础配置。 |
| `WORKTOOL_API_BASE` | `https://api.worktool.ymdyes.cn` | 否 | 否 | WorkTool API 基础地址。 |
| `CALLBACK_PUBLIC_BASE_URL` | 空 | 否 | 否 | 平台公开回调域名前缀。 |
| `ADMIN_PHONE_WHITELIST` | 空 | 视情况 | 否 | 管理员手机号白名单，逗号分隔。 |
| `DEMO_ROBOT_IDS` | 空 | 否 | 否 | 演示机器人 ID 列表（逗号分隔）。 |
| `ENABLE_ADMIN_IP_BLACKLIST` | `false` | 否 | 否 | 是否显示“黑名单管理”模块。 |
| `ENABLE_ADMIN_ENTERPRISE_AUTH` | `false` | 否 | 否 | 是否显示“企业定制开通”模块。 |
| `PRIVATE_LICENSE_SECRET_KEY` | 空 | 私有授权开启时是 | 是 | 私有 License 服务端生成密钥，必须保持 16 字节且不得进入 Git 或前端构建。 |
| `ENABLE_OPEN_TROUBLESHOOT_API` | `false` | 否 | 否 | 是否开启开放排查 API。 |
| `OPEN_TROUBLESHOOT_API_KEY` | 空 | 开启时是 | 是 | 开放排查 API 的访问密钥。 |
| `OPEN_TROUBLESHOOT_ALLOWED_ROBOT_IDS` | 空 | 否 | 否 | 开放排查 API 允许查询的机器人范围。 |

## WorkTool 扩展接口路径（可选）

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `WORKTOOL_IPACL_QUERY_PATH` | 空 | 黑名单功能开启时是 | 否 | 黑名单查询接口 path。 |
| `WORKTOOL_IPACL_ADD_PATH` | 空 | 黑名单功能开启时是 | 否 | 黑名单新增接口 path。 |
| `WORKTOOL_IPACL_DELETE_PATH` | 空 | 黑名单功能开启时是 | 否 | 黑名单删除接口 path。 |
| `WORKTOOL_WEWORK_AUTH_LIST_PATH` | 空 | 企业授权功能开启时是 | 否 | 企业授权列表接口 path。 |
| `WORKTOOL_WEWORK_AUTH_SAVE_PATH` | 空 | 企业授权功能开启时是 | 否 | 企业授权保存接口 path。 |
| `WORKTOOL_WEWORK_AUTH_DELETE_PATH` | 空 | 企业授权功能开启时是 | 否 | 企业授权删除接口 path。 |
| `WORKTOOL_DB_HOST` | 空 | 否 | 否 | 预留 WorkTool DB 连接地址。 |
| `WORKTOOL_DB_PORT` | `3306` | 否 | 否 | 预留 WorkTool DB 端口。 |
| `WORKTOOL_DB_USER` | 空 | 否 | 否 | 预留 WorkTool DB 用户名。 |
| `WORKTOOL_DB_PASSWORD` | 空 | 否 | 是 | 预留 WorkTool DB 密码。 |
| `WORKTOOL_DB_NAME` | 空 | 否 | 否 | 预留 WorkTool DB 库名。 |

## 短信（华瑞）

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `SMS_HUARUI_API_URL` | 空 | 短信开启时是 | 否 | 短信服务地址。 |
| `SMS_HUARUI_APPKEY` | 空 | 短信开启时是 | 是 | 短信 appkey。 |
| `SMS_HUARUI_APPSECRET` | 空 | 短信开启时是 | 是 | 短信 appsecret。 |
| `SMS_CODE_EXPIRE_MINUTES` | `15` | 否 | 否 | 短信验证码有效期（分钟）。 |

## 默认测试引擎与回调并发

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `DEFAULT_TEST_PROVIDER_ENABLED` | `false` | 否 | 否 | 是否启用系统级测试 AI 引擎。 |
| `DEFAULT_TEST_PROVIDER_NAME` | `AI模型(仅测试用)` | 否 | 否 | 测试引擎名称。 |
| `DEFAULT_TEST_PROVIDER_BASE_URL` | `https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions` | 开启时是 | 否 | 测试引擎地址。 |
| `DEFAULT_TEST_PROVIDER_API_KEY` | 空 | 开启时是 | 是 | 测试引擎 token。 |
| `DEFAULT_TEST_PROVIDER_MODEL` | `doubao-seed-2.0-lite` | 否 | 否 | 测试引擎 model。 |
| `QA_CALLBACK_WORKER_CONCURRENCY` | `16` | 否 | 否 | QA 回调异步 worker 数。 |
| `QA_CALLBACK_QUEUE_MAXSIZE` | `2000` | 否 | 否 | QA 回调队列长度。 |
| `ROBOT_SHOW_NAME_CACHE_TTL_SECONDS` | `600` | 否 | 否 | 机器人昵称缓存秒数。 |

## 对话上下文记忆（轻量）

| 变量 | 默认值 | 必填 | 敏感 | 说明 |
|---|---|---|---|---|
| `CHAT_CONTEXT_ENABLED` | `true` | 否 | 否 | 是否启用群聊/私聊上下文记忆。 |
| `CHAT_CONTEXT_MAX_MESSAGES` | `20` | 否 | 否 | 单会话最多保留消息数。 |
| `CHAT_CONTEXT_RETENTION_DAYS` | `7` | 否 | 否 | 上下文数据保留天数。 |

## 生产建议

1. `AUTH_JWT_SECRET`、`MYSQL_PASSWORD`、`APP_MYSQL_PASSWORD`、各类 `*_KEY/*_SECRET` 必须替换成强随机值。
2. 开源场景建议默认关闭：`ENABLE_ADMIN_IP_BLACKLIST`、`ENABLE_ADMIN_ENTERPRISE_AUTH`、`ENABLE_OPEN_TROUBLESHOOT_API`。
3. 小流量先用：`QA_CALLBACK_WORKER_CONCURRENCY=8~16`；高峰再按监控调优。
4. 上下文记忆建议保持轻量：`CHAT_CONTEXT_MAX_MESSAGES=20`、`CHAT_CONTEXT_RETENTION_DAYS=7`。
