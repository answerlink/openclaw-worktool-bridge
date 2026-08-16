# OpenClaw WorkTool Bridge

WorkTool 企业微信机器人桥接服务。  
用于承接 WorkTool 消息回调、按规则路由 Provider、并下发回复消息；同时提供可视化管理后台。

## Features

- React + FastAPI 前后端分离
- 机器人配置 / 规则管理 / 消息监控
- WorkTool 机器人信息与回调管理
- Docker Compose 一键启动（前端、后端、MySQL）

## Quick Start

1. 一键部署（自动生成强密码并完成 WorkTool 连通性检查）

```bash
PUBLIC_BASE_URL=http://YOUR_PUBLIC_IP:18080 ./deploy.sh
```

远程 WorkTool 可显式指定：

```bash
WORKTOOL_API_BASE=https://worktool.example.com \
PUBLIC_BASE_URL=https://bridge.example.com \
./deploy.sh
```

2. 访问控制台

- `http://YOUR_PUBLIC_IP:18080`

3. 重复验收：`./verify-deployment.sh`

Private 模式首次启动会根据 `.env` 自动创建管理员账号：

- `PRIVATE_ADMIN_USERNAME`：默认 `admin`
- `PRIVATE_ADMIN_PASSWORD`：首次部署时自动生成，交付后可修改
- `PRIVATE_SELF_REGISTRATION_ENABLED=false`：关闭自助注册，后续账号由管理员在“用户管理”中创建

管理员首次登录后可修改密码；服务重启不会重置已存在管理员的密码。
这组初始管理员配置仅在 `APP_DEPLOYMENT_MODE=private` 时生效；SaaS 模式不会创建或启用该账号。

## Services

- `worktool-backend`: FastAPI backend
- `worktool-frontend`: Nginx + frontend static files
- `worktool-mysql`: MySQL 8.4

## Notes

- 默认使用 MySQL（持久化在 Docker Volume）
- `.env` 文件仅本地使用，不应提交到仓库
- `.env`、`mysql_data/` 和 `uploads/` 是升级时必须保留的数据

## License

MIT License. See [LICENSE](./LICENSE).
