# 部署与运维

本页部署的是 Console 管理平台。还需要已可用的 WorkTool 服务、机器人 ID 和安卓客户端。

## 部署前准备

准备支持 Docker Compose 的主机、可访问的 WorkTool 服务地址，以及浏览器和回调发送方能访问的 Console 地址。生产环境使用有效域名与 HTTPS；不要将 `YOUR_PUBLIC_IP` 这样的示例值原样投入使用。

仓库支持一键部署和手动 Compose 部署。执行前阅读仓库当前 README，并备份已有 `.env` 与数据。

## 一键部署

在仓库根目录运行，把地址换成你的实际地址：

```bash
WORKTOOL_API_BASE=https://worktool.example.com \
PUBLIC_BASE_URL=https://console.example.com \
./deploy.sh
```

脚本负责生成部署所需配置并检查 WorkTool 连通性。部署后可再次运行验收脚本：

```bash
./verify-deployment.sh
```

## 手动部署

首次部署复制配置：

```bash
cp .env.example .env
```

编辑 `.env`，至少核对：

- `WORKTOOL_API_BASE` 指向你的 WorkTool 服务。
- `CALLBACK_PUBLIC_BASE_URL` 和 `APP_PUBLIC_BASE_URL` 使用实际可访问的 Console 地址。
- MySQL 容器初始化密码与应用连接密码对应一致。
- `AUTH_JWT_SECRET` 使用独立强随机值；修改管理员示例密码。
- 默认外部端口为 `18080`；按需设置绑定地址和反向代理。

然后启动并检查：

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 backend scheduler
```

这套 Compose 包含 MySQL、backend、frontend、scheduler。调度器执行定时任务、事件任务等后台工作，不能只启动网页和接口服务。

## 首次登录

Private 模式首次启动根据 `PRIVATE_ADMIN_USERNAME`、`PRIVATE_ADMIN_PASSWORD` 创建管理员。已有账号不会因重启而重置密码。默认关闭自助注册，后续可由管理员创建用户。

登录后先绑定一台测试机器人，验证消息接入、AI 回复、指令执行，再验证事件接收与事件任务。

## 网络与时间

Compose 使用上海时区，数据库会话默认 `+08:00`。定时任务还需核对自身时区。

示例 WorkTool 地址 `http://host.docker.internal:15080` 用于访问宿主机网关，不是所有部署通用地址。容器里的 `localhost` 指向当前容器，并非另一台主机或宿主机。

客户端直发与服务端回调分别需要相应网络可达。仅从浏览器能打开回调地址，不足以验证所有发送路径。

## 配置更新

环境变量修改后需重新创建相关容器才会生效；只刷新页面或重启浏览器无效。后端与调度器涉及共同配置时应同时更新。统计相关 `VITE_*` 是构建参数，需重新构建前端。

完整参数与示例值见[环境变量参考](/docs/env-reference.html)。示例配置、Compose 默认值和代码兜底值可能不同，以实际加载配置为准。

## 备份、升级与回退

1. 记录当前代码版本和镜像版本，备份数据库、`.env` 和 `uploads/`。
2. 先在测试环境运行新版本，检查数据库变更及现有配置兼容性。
3. 更新生产服务，检查健康状态、登录、消息回调、事件回调、规则回复和任务调度。
4. 出现问题时用已保存镜像回退；若包含数据库迁移，先评估旧版是否兼容新结构，不要盲目覆盖数据。

Compose 中 `mysql_data/` 是持久化数据目录，不能当构建缓存删除。MySQL 运行中直接复制数据目录不等于可靠备份，应使用一致性数据库备份或停库快照，并验证可恢复。

## 文档与公开入口

静态文档位于 `/docs/`，同时提供 `/sitemap.xml`、`/llms.txt`、`/llms-full.txt` 及 `/robots.txt`。使用自有域名时核对其中公开链接；这些入口不应包含凭证或私有业务数据。

文档源码在 `frontend/docs-md/`，导航与生成器在 `frontend/scripts/build-docs.mjs`。修改后运行前端的文档构建，并发布生成的静态文件，避免只改 Markdown 而线上内容不变。
