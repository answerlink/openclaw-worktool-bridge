"""Opt-in WorkTool command-result -> WeCom notifications (type=1)."""
import json
import secrets
from urllib.parse import urlsplit, parse_qs, quote

import aiohttp
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from feedback import post_message

SCHEMA = """CREATE TABLE IF NOT EXISTS robot_command_failure_notifications (
 robot_id VARCHAR(128) PRIMARY KEY,
 webhook_url VARCHAR(2048) NOT NULL DEFAULT '',
 callback_token VARCHAR(128) NOT NULL,
 callback_url VARCHAR(2048) NOT NULL DEFAULT '',
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"""


class Config(BaseModel):
    robot_id: str = Field(min_length=1, max_length=128)
    webhook_url: str = Field(default='', max_length=2048)
    replace_existing: bool = False


def validate_webhook(value):
    value = value.strip()
    u = urlsplit(value)
    if value and not (u.scheme == 'https' and u.netloc == 'qyapi.weixin.qq.com'
                      and u.path == '/cgi-bin/webhook/send' and not u.fragment
                      and any(k.strip() for k in parse_qs(u.query).get('key', []))):
        raise HTTPException(400, '请填写包含 key 的企业微信机器人 Webhook 地址')
    return value


def failure_text(robot_id, body):
    code = body.get('errorCode')
    failed = body.get('failList')
    partial = isinstance(failed, list) and bool(failed)
    # Unknown/malformed status is not treated as execution failure.
    known = not isinstance(code, bool) and (isinstance(code, int) or
            isinstance(code, str) and code.strip().isdigit())
    if not partial and not (known and int(code) != 0):
        return None
    text = '\n'.join(['【指令执行失败】', f'机器人：{robot_id}',
                      f'消息 ID：{str(body.get("messageId", ""))[:160]}',
                      f'指令类型：{str(body.get("type", ""))[:40]}',
                      f'错误码：{str(code)[:40]}',
                      f'失败原因：{str(body.get("errorReason") or "未提供")[:400]}',
                      f'失败对象：{", ".join(str(x)[:80] for x in failed[:10]) if partial else "未提供"}'])
    return text.encode('utf-8')[:2000].decode('utf-8', errors='ignore')


class Service:
    def __init__(self, main):
        self.m = main

    def read(self, rid):
        conn = self.m.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT robot_id,webhook_url,callback_token,callback_url FROM robot_command_failure_notifications WHERE robot_id=%s', (rid,))
                return cur.fetchone()
        finally:
            conn.close()

    def write(self, rid, webhook, token, callback):
        conn = self.m.db_conn()
        try:
            with conn.cursor() as cur:
                cur.execute('''INSERT INTO robot_command_failure_notifications(robot_id,webhook_url,callback_token,callback_url)
                    VALUES(%s,%s,%s,%s) ON DUPLICATE KEY UPDATE webhook_url=VALUES(webhook_url),
                    callback_token=VALUES(callback_token),callback_url=VALUES(callback_url)''', (rid, webhook, token, callback))
            conn.commit()
        finally:
            conn.close()

    async def bound(self, rid):
        res = await self.m.fetch_worktool_api('/robot/robotInfo/callBack/get', {'robotId': rid})
        self.m._ensure_worktool_ok(res, '读取指令回调')
        rows = self.m._flatten_callback_items(res.get('data'))
        return next((self.m._extract_callback_url(r) for r in rows if str(r.get('type')) == '1'), '')

    async def save(self, body):
        rid = body.robot_id.strip()
        if not rid:
            raise HTTPException(400, 'robot_id required')
        webhook = validate_webhook(body.webhook_url)
        old = self.read(rid)
        # No opt-in: no writes or WorkTool requests at all.
        if not webhook and not old:
            return {'ok': True, 'enabled': False}
        current = await self.bound(rid)
        managed = bool(old and current and current == old['callback_url'])
        if not webhook:
            # Disable local sends first, including when remote outcome is uncertain.
            self.write(rid, '', old['callback_token'], old['callback_url'])
            if managed:
                await self.m.delete_callback_by_type(rid, 1)
            return {'ok': True, 'enabled': False}
        if current and not managed and not body.replace_existing:
            raise HTTPException(409, '已有第三方指令结果回调。启用将替换该地址，原地址不再接收结果，是否继续？')
        base = self.m.get_callback_public_base_url()
        if not base:
            raise HTTPException(400, '管理员尚未配置平台公网回调地址')
        token = old['callback_token'] if old and old['webhook_url'] else secrets.token_urlsafe(32)
        callback = f'{base}/api/v1/callback/command-result/{quote(rid, safe="")}?token={token}'
        # Persist before binding: immediate callbacks work; an uncertain bind can be reconciled on refresh.
        self.write(rid, webhook, token, callback)
        if current != callback:
            await self.m.bind_callback_by_type(rid, callback, 1)
        return {'ok': True, 'enabled': True}

    async def receive(self, rid, token, body):
        row = self.read(rid)
        if not row or not secrets.compare_digest(token.encode('utf-8'), row['callback_token'].encode('utf-8')):
            raise HTTPException(403, 'invalid callback token')
        if not row['webhook_url']:
            return {'ok': True}
        text = failure_text(rid, body)
        if text:
            try:
                async with self.m.safe_outbound_session(aiohttp.ClientTimeout(total=8), deployment_mode=self.m.APP_DEPLOYMENT_MODE) as session:
                    await post_message(session, validate_webhook(row['webhook_url']), {'msgtype': 'text', 'text': {'content': text}})
            except Exception:
                # Never log webhook secrets or callback payloads.
                self.m.logging.warning('command failure notification delivery failed robot_id=%s', rid)
                raise HTTPException(502, '企微通知发送失败') from None
        return {'ok': True}


def install(main):
    service = Service(main)

    @main.app.get('/api/v1/robot-info/command-failure-notification')
    async def get_config(robot_id: str, user=Depends(main.get_current_user)):
        main._require_robot_access(int(user['id']), robot_id)
        row = service.read(robot_id)
        return {'webhook_url': row['webhook_url'] if row else '',
                'callback_url': row['callback_url'] if row else ''}

    @main.app.post('/api/v1/robot-info/command-failure-notification')
    async def save_config(body: Config, user=Depends(main.get_current_user)):
        main._require_robot_access(int(user['id']), body.robot_id.strip())
        main._reject_demo_robot_write(body.robot_id.strip(), '指令失败通知', user=user)
        try:
            return await service.save(body)
        except (TimeoutError, aiohttp.ClientError):
            raise HTTPException(502, 'WorkTool 请求结果未确认，请刷新核对绑定状态后再操作') from None

    @main.app.post('/api/v1/callback/command-result/{robot_id}')
    async def receive(robot_id: str, request: Request, token: str = ''):
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 262144:
                raise HTTPException(413, 'callback too large')
        try:
            body = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, 'invalid JSON') from None
        if not isinstance(body, dict):
            raise HTTPException(400, 'expected object')
        return await service.receive(robot_id, token, body)

    return service
