# WorkTool Console 使用指南

WorkTool Console 用于管理企微机器人：接收消息和事件、按规则调用 AI、下发指令，以及配置转发、定时任务和事件任务。

Console、WorkTool 服务和安卓客户端共同完成工作：Console 决定做什么，WorkTool 服务传递指令，安卓客户端在企业微信里执行。Console 收到请求或指令提交成功，不等于手机已执行成功。

## 从哪里开始

| 你的需求 | 阅读入口 |
| --- | --- |
| 第一次接入机器人 | [快速开始](/docs/quickstart.html) |
| 配置消息、事件和上下线通知 | [机器人与回调](/docs/robot-callback.html) |
| 群聊或私聊自动回复 | [规则配置](/docs/rules.html)、[AI 回复引擎](/docs/ai-provider.html) |
| 查看群名、备注，按标签选择群 | [群列表与标签](/docs/groups-tags.html) |
| 立即发消息、文件、建群或拉人 | [指令下发与查询](/docs/command-tasks.html) |
| 每天提醒、按时执行指令 | [定时任务](/docs/scheduled-tasks.html) |
| 通过好友申请后欢迎、建群、拉人 | [事件任务](/docs/event-tasks.html) |
| 将收到的文字转发到其他会话 | [消息转发](/docs/forwarding.html) |
| 查看消息和事件，定位失败 | [消息监控与排障](/docs/monitoring.html) |
| 自行部署或管理账号 | [部署运维](/docs/deploy.html)、[管理员手册](/docs/admin.html) |

## 使用前需要什么

- 已可用的 WorkTool 机器人 ID，以及运行 WorkTool 和企业微信的安卓设备。
- 安卓端主功能正常开启，机器人在线，并能访问对应的 WorkTool 服务。
- Console 账号；使用 AI 回复时，还需可用的回复引擎。

公有云与独立部署的菜单可能不同，以当前账号权限和部署开关为准。部署 Console 本身不会安装 WorkTool 服务或安卓客户端。

## 数据与记录

消息监控、收发日志、轻量上下文默认保留 15 天；上下文默认最多取最近 20 条消息。事件记录保留 30 天。这些记录用于操作和排查，不宜作为永久聊天归档。独立部署的保留参数见[环境变量参考](/docs/env-reference.html)。
