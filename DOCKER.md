# Docker 一键部署

## 1. 启动

```bash
PUBLIC_BASE_URL=http://YOUR_PUBLIC_IP:18080 ./deploy.sh
```

启动后访问：
- 前端: `http://YOUR_PUBLIC_IP:18080`
- 后端: 仅容器内访问（由前端 Nginx 反代 `/api`）
- MySQL: `worktool-mysql`（仅容器网络内访问）

## 2. 停止

```bash
docker compose down
```

## 3. 查看日志

```bash
docker compose logs -f mysql
docker compose logs -f backend
docker compose logs -f frontend
```

## 4. 数据持久化（纯 Docker 卷）

MySQL 数据使用部署目录：
- 数据目录：`./mysql_data`（容器内 `/var/lib/mysql`）

删除容器不会丢失数据库。

## 5. 进入 MySQL（可选）

```bash
docker compose exec mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE}
```

## 配置和验收

- `WORKTOOL_API_BASE`：WorkTool 集群网关，默认同机 `http://host.docker.internal:15080`
- `PUBLIC_BASE_URL`：首次部署的公网 URL，同时用于 WorkTool 消息回调
- `WEB_PORT`：公网监听端口，默认 `18080`
- `APP_DEPLOYMENT_MODE=private`：私有化部署允许访问内网 WorkTool；SaaS 模式仅允许公网出站
- `PRIVATE_ADMIN_USERNAME` / `PRIVATE_ADMIN_PASSWORD`：Private 首次启动的管理员账号
- `PRIVATE_SELF_REGISTRATION_ENABLED=false`：关闭客户自助注册，由管理员统一创建账号
- `PRIVATE_LICENSE_V2_PRIVATE_KEY_BASE64`：仅 SaaS 管理员签发 RSA v2 授权时配置，值为 PKCS#8 PEM 私钥的单行 Base64；不要提交到 Git

重复执行 `./deploy.sh` 不会覆盖 `.env`。执行 `./verify-deployment.sh` 可验证容器、Bridge、WorkTool 和公网入口。

## WorkTool 主备故障转移

```dotenv
WORKTOOL_API_BASE=http://10.0.4.8:15085
WORKTOOL_API_FALLBACK_BASE=http://10.0.16.5:15085
```

备用地址可选，留空或与主地址相同时保持单节点行为。地址需要 HTTP/HTTPS 协议，
不接受 URL 用户密码、query 或 fragment。两个节点应为同一 WorkTool 集群，
共享数据、鉴权及跨节点指令投递能力。

启用备用地址后，TCP 建连超时为 2 秒，整体超时保持各接口原有设置（通常 10 秒，
消息发送 15 秒，客户端日志查询 3 秒）；主备尝试和恢复探测共享整体时间预算。
这不是把完整请求限制为 2 秒。只读 GET 在连接/响应异常或 HTTP 502/503/504 时
最多换节点重试一次；业务错误、其他 HTTP 状态和 JSON 解析错误不重试。
POST 只有明确发生在请求发送前的连接失败才允许重试。发送后的超时、断连及
网关错误返回“操作结果暂未确认”，不自动重发，避免重复消息和指令。
若首次查询已耗尽整体预算，则当前请求不再重试，后续请求切换备用节点。

故障节点暂停访问 30 秒。冷却结束后的请求触发一次 GET `/test/version` 探测
（最多 2 秒），HTTP 200 且业务 code=200 才恢复；并发请求不重复探测。
主节点恢复后优先回主。主备均故障且尚在冷却时快速返回 503。
状态按进程保存在内存，backend 与 scheduler 独立判断，重启后重置。
日志事件：`worktool_node_unavailable`、`worktool_fallback_request`、
`worktool_node_recovered`，不包含请求正文或鉴权头。

覆盖 WorkTool HTTP 查询、消息/指令、回调管理、续期与排查请求；
指定节点的维护请求保持原目标，WorkTool MySQL 直连查询不受影响。
运维环境变量配置的 WorkTool 节点允许私网访问；其他用户提供的回调和 AI 地址
继续执行原有出站安全策略，禁止自动跟随重定向。

修改配置后重建并更新 **backend 和 scheduler**：

```bash
docker compose build backend scheduler
docker compose up -d --no-deps backend scheduler
```

回退时清空 `WORKTOOL_API_FALLBACK_BASE` 并重建这两个容器即可恢复单节点访问。
