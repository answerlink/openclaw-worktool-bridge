# AI 回复引擎

## 字段说明

- AI 回复引擎：用于区分不同渠道配置
- Base URL：模型服务地址
- API Token：模型访问凭证（OpenClaw 可留空）
- Model：模型名或 model_id
- 引擎类型：例如 OpenAI 或 OpenClaw

## Model 从哪里找

通常在模型平台的 API 文档中查找。

示例：

- `doubao-seed-2.0-lite`
- `gpt-4o-mini`
- `Qwen/Qwen3-8B`

## 新增与测试

新增或编辑引擎后，建议先点“测试接口”。

测试成功会显示响应耗时，失败会显示错误信息。

## 提问人信息注入模式

引擎支持 3 档配置：

- 关闭：不注入提问人信息
- 注入到 system prompt：把机器人身份/同事名单/当前提问者写入 system 消息
- 通过额外字段 variables：把 `variables.prompt_inject` 传给第三方编排层

说明：

- 当你选择“额外字段”模式时，console 只发送 `variables.prompt_inject`，不会覆盖 system prompt；需在第三方工作流里自行把 `variables.prompt_inject` 合并到 system prompt。
- 若配置了“我的同事”名单，会自动参与注入内容，并用于群聊未@同事发言的跳过策略。

## OpenClaw 模式

- OpenClaw 走 webhook 透传，平台会把 WorkTool 回调负载直接转发到你配置的地址。
- OpenClaw 不要求 `model` 和 `扩展JSON`，可按实际渠道留空。

## 多账号可见性

系统支持“可见但不可改”的共享引擎能力。

如果你无权管理某引擎，会显示“无法修改”。
