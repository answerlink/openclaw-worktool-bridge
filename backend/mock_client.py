"""Optional Console adapter. Protocol/runtime state belongs exclusively to the Node service."""
import json
import os
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response


@dataclass
class Settings:
    enabled: bool = False
    service_url: str = 'http://127.0.0.1:8788'
    service_key: str = ''
    public_base_url: str = ''

    @classmethod
    def from_env(cls):
        return cls(
            enabled=os.getenv('ENABLE_MOCK_CLIENT', 'false').lower() in {'1', 'true', 'yes', 'on'},
            service_url=os.getenv('MOCK_CLIENT_URL', 'http://127.0.0.1:8788').rstrip('/'),
            service_key=os.getenv('MOCK_CLIENT_SERVICE_KEY', ''),
            public_base_url=os.getenv('MOCK_CLIENT_PUBLIC_BASE_URL', os.getenv('APP_PUBLIC_BASE_URL', '')).rstrip('/'),
        )


class MockClientService:
    MAX_BODY = 1024 * 1024
    MAX_RESPONSE = 16 * 1024 * 1024

    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport  # injectable only for isolated tests

    def check_enabled(self):
        if not self.settings.enabled:
            raise HTTPException(404, '模拟客户端功能未开启')

    async def body(self, request: Request):
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > self.MAX_BODY:
                raise HTTPException(413, '请求内容超过1 MiB')
        try:
            value = json.loads(data or b'{}')
        except (ValueError, UnicodeError):
            raise HTTPException(400, '需要有效JSON')
        if not isinstance(value, dict):
            raise HTTPException(400, '请求需要JSON对象')
        return value

    async def forward(self, request: Request, method: str, path: str, user=None, payload=None):
        self.check_enabled()
        # Upstream is deployment configuration, never a URL supplied by an API caller.
        url = urlsplit(self.settings.service_url)
        if url.scheme not in {'http', 'https'} or not url.hostname or url.path not in {'', '/'} or url.query or url.fragment or url.username:
            raise HTTPException(503, '模拟服务地址配置错误')
        if len(self.settings.service_key) < 16:
            raise HTTPException(503, '模拟服务密钥未配置或长度不足16位')
        base = self.settings.public_base_url or str(request.base_url).rstrip('/')
        public = urlsplit(base)
        if public.scheme not in {'http', 'https'} or not public.hostname or public.query or public.fragment or public.username:
            raise HTTPException(503, '模拟回调公开地址配置错误')
        headers = {
            'Host': f'127.0.0.1:{url.port or (443 if url.scheme == "https" else 80)}',
            'X-Mock-Service-Key': self.settings.service_key,
            'X-Mock-Callback-Base': base + '/api/v1/mock-client/',
        }
        if user is not None:
            headers['X-Mock-User'] = str(user['id'])
        params = {k: v for k, v in request.query_params.items() if k in {'epoch', 'after', 'callbackAfter'}}
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False, transport=self.transport) as client:
                async with client.stream(method, self.settings.service_url + path, headers=headers, params=params, json=payload) as upstream:
                    content = bytearray()
                    async for chunk in upstream.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > self.MAX_RESPONSE:
                            raise HTTPException(502, '模拟服务响应过大')
                    if not 200 <= upstream.status_code < 300:
                        try:
                            error = json.loads(content).get('error', '模拟服务请求失败')
                        except (ValueError, AttributeError):
                            error = '模拟服务请求失败'
                        status = upstream.status_code if upstream.status_code in {400, 404, 409, 413, 415} else 502
                        raise HTTPException(status, error)
                    return Response(bytes(content), status_code=upstream.status_code, media_type='application/json', headers={'Cache-Control': 'no-store'})
        except httpx.HTTPError:
            raise HTTPException(503, '模拟服务暂不可用，请检查服务是否启动')


def install(app, get_current_user, require_admin, settings: Optional[Settings] = None, transport=None):
    service = MockClientService(settings or Settings.from_env(), transport)
    router = APIRouter(prefix='/api/v1/admin/mock-client', tags=['mock-client'])

    def access(user=Depends(get_current_user)):
        service.check_enabled()
        require_admin(user)
        return user

    @router.get('/sessions')
    async def sessions(request: Request, user=Depends(access)):
        return await service.forward(request, 'GET', '/api/sessions', user)

    @router.post('/sessions')
    async def create(request: Request, user=Depends(access)):
        return await service.forward(request, 'POST', '/api/sessions', user, await service.body(request))

    @router.get('/sessions/{session_id}/{operation}')
    async def read(session_id: UUID, operation: str, request: Request, user=Depends(access)):
        if operation not in {'state', 'export', 'scenario-status'}:
            raise HTTPException(404, '未知模拟操作')
        return await service.forward(request, 'GET', f'/api/sessions/{session_id}/{operation}', user)

    @router.post('/sessions/{session_id}/{operation}')
    async def operate(session_id: UUID, operation: str, request: Request, user=Depends(access)):
        if operation not in {'connect', 'stop', 'delete', 'action', 'rules', 'demo-command', 'scenario-start'}:
            raise HTTPException(404, '未知模拟操作')
        return await service.forward(request, 'POST', f'/api/sessions/{session_id}/{operation}', user, await service.body(request))

    # Test callbacks intentionally use their own capability URL, not production robot callbacks.
    @app.post('/api/v1/mock-client/callbacks/{token}', include_in_schema=False)
    async def callback(token: UUID, request: Request):
        service.check_enabled()
        return await service.forward(request, 'POST', f'/callbacks/{token}', payload=await service.body(request))

    app.include_router(router)
    return service
