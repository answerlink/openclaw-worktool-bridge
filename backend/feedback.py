"""Authenticated feedback delivery to the configured WeCom group robot."""
import asyncio
import base64
import binascii
import hashlib
import os
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit, parse_qs
from typing import Literal

import aiohttp
from fastapi import HTTPException
from pydantic import BaseModel, Field


class FeedbackPayload(BaseModel):
    kind: Literal['problem', 'suggestion']
    description: str = Field(min_length=1, max_length=1500)
    contact: str = Field(default='', max_length=150)
    page: str = Field(max_length=300)
    robot_id: str = Field(default='', max_length=300)
    images: list[str] = Field(default_factory=list, max_length=3)


def image_message(value: str) -> dict:
    if len(value) > 2800000:
        raise HTTPException(400, '每张截图不能超过 2MB')
    try:
        header, encoded = value.split(',', 1)
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(400, '截图格式无效') from None
    if not raw or len(raw) > 2 * 1024 * 1024:
        raise HTTPException(400, '每张截图不能超过 2MB')
    if not ((header == 'data:image/png;base64' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or
            (header == 'data:image/jpeg;base64' and raw.startswith(b'\xff\xd8\xff'))):
        raise HTTPException(400, '截图仅支持 PNG 或 JPEG')
    return {'msgtype': 'image', 'image': {'base64': encoded, 'md5': hashlib.md5(raw).hexdigest()}}


async def post_message(session, url: str, payload: dict):
    async with session.post(url, json=payload, allow_redirects=False) as response:
        if response.status != 200:
            raise ValueError('wecom http failure')
        result = await response.json()
        if not isinstance(result, dict) or result.get('errcode') != 0:
            raise ValueError('wecom delivery failure')


async def submit_feedback(body: FeedbackPayload, user: dict) -> dict:
    url = os.getenv('FEEDBACK_WECOM_WEBHOOK_URL', '').strip()
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.netloc != 'qyapi.weixin.qq.com' or
            parsed.path != '/cgi-bin/webhook/send' or not parse_qs(parsed.query).get('key')):
        raise HTTPException(503, '建议与反馈暂未配置，请联系管理员')
    if not body.description.strip():
        raise HTTPException(400, '请填写反馈内容')
    images = [image_message(value) for value in body.images]
    feedback_id = uuid.uuid4().hex[:12]
    kind = '问题反馈' if body.kind == 'problem' else '功能建议'
    content = '\n'.join([
        f'【{kind}】{feedback_id}',
        f'账号：{user.get("phone", "")}（ID：{user["id"]}）',
        f'时间：{datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S")}',
        f'机器人 ID：{body.robot_id.strip()}',
        f'页面：{body.page}', f'联系方式：{body.contact.strip() or "未填写"}',
        f'截图：{len(images)} 张（紧随本条消息）', '', body.description.strip(),
    ])
    # WeCom text messages support at most 2048 UTF-8 bytes.
    chunks = []
    chunk = ''
    for char in content:
        if len((chunk + char).encode('utf-8')) > 1800:
            chunks.append(chunk)
            chunk = ''
        chunk += char
    if chunk:
        chunks.append(chunk)
    messages = [{'msgtype': 'text', 'text': {'content': f'[{feedback_id} {i + 1}/{len(chunks)}]\n{part}'}}
                for i, part in enumerate(chunks)] + images
    delivered = 0
    try:
        async with asyncio.timeout(55):
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                for payload in messages:
                    await post_message(session, url, payload)
                    delivered += 1
    except (aiohttp.ClientError, TimeoutError, ValueError):
        detail = '发送失败，请稍后重试'
        if delivered:
            detail = f'反馈 {feedback_id} 已部分发送，重试可能产生重复消息；请保留内容后重试'
        raise HTTPException(502, detail) from None
    return {'ok': True, 'feedback_id': feedback_id}
