# 部署与运维

## Docker 部署

推荐使用 `docker compose` 统一启动：

1. MySQL
2. Backend
3. Frontend
4. Scheduler（定时任务执行 Worker）

## 时区建议

MySQL 和应用统一使用 `Asia/Shanghai`，便于日志和数据库对齐。

## 环境变量

重点关注：

- WorkTool API Base
- 短信服务配置
- 默认测试 AI 引擎开关与参数
- `DEMO_ROBOT_IDS`：演示机器人 ID 列表（逗号分隔）

## 演示机器人只读模式

当机器人 ID 在 `DEMO_ROBOT_IDS` 中时：

- 允许：查看配置、下发指令任务
- 禁止：修改回调地址、标签库、定时任务、消息转发、机器人规则/配置

适合用于销售演示、培训账号、公共体验环境。

## 升级建议

- 先在测试环境验证迁移与回调链路
- 再滚动升级生产
- 升级后验证：登录、规则命中、AI 回复、转发、监控
