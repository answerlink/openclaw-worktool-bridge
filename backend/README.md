# Backend 启动说明

## 1. 安装依赖

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2. 启动服务

```bash
cd backend
python main.py
```

默认监听 `0.0.0.0:8000`。

## 3. 首次启动自动导入

若项目根目录存在 `config.json`，且数据库 `backend/app.db` 中暂无机器人数据，服务会自动导入。


### 建议与反馈

配置后端环境变量 `FEEDBACK_WECOM_WEBHOOK_URL` 为企业微信群机器人 Webhook，留空时提交返回未配置提示。Docker Compose 已透传该变量，修改后需重建并重启前后端服务。

登录用户可从侧栏底部提交问题或建议，附带当前账号、选中的机器人 ID（未选择时留空）、页面路径、北京时间和最多 3 张截图。支持当前可见区域截图、粘贴与上传；前端压缩为 JPEG，后端限制每张 2MB。跨域 iframe 等内容可能无法被页面截图捕获，可使用系统截图粘贴。

通知按文字、图片顺序发送，长文字自动分段，文字包含反馈编号。发送失败时前端保留草稿；部分发送会明确提示，重试可能产生重复消息。当前版本不保存反馈历史，关闭弹窗保留当前会话草稿，刷新页面会丢失。

验证：`cd backend && python -m unittest test_feedback -v`（企业微信请求使用模拟响应）。

### 企业定制开通分享

管理员可在企业授权编辑弹窗生成、复制、重新生成或关闭分享链接。链接默认长期有效，使用 32 字节安全随机令牌，只关联单条 CorpId；重新生成或关闭后旧令牌立即失效。通过本平台删除授权时，会在同一事务中清理分享记录和部署类型信息。

公开页面 `/share/enterprise/{token}` 独立于管理台登录流程，公开接口 `GET /api/v1/public/enterprise-authorization/{token}` 只返回 CorpId、企业名称、AgentId、部署类型、启用状态、到期时间，绝不返回备注或其他上游字段。每次加载均查询最新记录，刷新页面可看到已保存的修改。启用状态和有效期属于展示信息，不影响链接自身有效性。

令牌保存在本平台数据库的 `enterprise_authorization_shares` 表，后端启动自动创建。功能沿用 `ENABLE_ADMIN_ENTERPRISE_AUTH` 开关；分享接口与页面禁止缓存和搜索引擎索引。生成、重新生成和关闭操作进入管理员审计，但审计中不保存分享令牌。

验证：`cd backend && python -m unittest test_enterprise_shares -v`。
