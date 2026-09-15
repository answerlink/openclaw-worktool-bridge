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
