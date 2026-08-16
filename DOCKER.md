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

重复执行 `./deploy.sh` 不会覆盖 `.env`。执行 `./verify-deployment.sh` 可验证容器、Bridge、WorkTool 和公网入口。
