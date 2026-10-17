"""Process-local WorkTool primary/fallback transport; never replay uncertain writes."""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass

import aiohttp
from fastapi import HTTPException

from safe_outbound_http import read_limited_text, safe_outbound_session, validate_outbound_url_shape

logger = logging.getLogger(__name__)
CONNECT_SECONDS = 2
COOLDOWN_SECONDS = 30
RETRY_STATUSES = {502, 503, 504}


def normalize_base(value):
    parsed = validate_outbound_url_shape(value.strip().rstrip('/'))
    if parsed.query_string:
        raise ValueError('WorkTool base URL must not contain query parameters')
    return str(parsed).rstrip('/')


@dataclass
class NodeState:
    failed_until: float = 0
    probing: bool = False
    generation: int = 0


# Shared by HTTP helpers, troubleshooting and message delivery in this process.
_states = {}


class BufferedResponse:
    """Small response compatible with read_limited_text, bounded before buffering."""
    def __init__(self, status, text):
        self.status = status
        self._bytes = text.encode('utf-8')
        self.charset = 'utf-8'
        self.content_length = len(self._bytes)
        self.content = self

    async def iter_chunked(self, size):
        for offset in range(0, len(self._bytes), size):
            yield self._bytes[offset:offset + size]


class WorktoolSession:
    def __init__(self, primary, fallback, timeout, deployment_mode, session_factory):
        self.nodes = (normalize_base(primary), normalize_base(fallback))
        self.timeout = timeout
        self.mode = deployment_mode
        self.session_factory = session_factory
        self.states = _states.setdefault(self.nodes, {n: NodeState() for n in self.nodes})

    def _fail(self, node, reason):
        state = self.states[node]
        state.failed_until = time.monotonic() + COOLDOWN_SECONDS
        state.generation += 1
        logger.warning('worktool_node_unavailable node=%s reason=%s cooldown_seconds=%s', node, reason, COOLDOWN_SECONDS)

    def _mode_for(self, node):
        # Only operator-configured WorkTool bases are trusted private endpoints.
        # Arbitrary callback/provider URLs still use the existing outbound policy.
        configured = {os.getenv(k, '').strip().rstrip('/') for k in ('WORKTOOL_API_BASE', 'WORKTOOL_API_FALLBACK_BASE')}
        return 'private' if node in configured else self.mode

    async def _attempt(self, node, method, suffix, remaining, **kwargs):
        timeout = aiohttp.ClientTimeout(
            total=remaining, sock_connect=min(CONNECT_SECONDS, remaining),
            sock_read=self.timeout.sock_read, ceil_threshold=float('inf'),
        )
        async with self.session_factory(timeout, deployment_mode=self._mode_for(node)) as session:
            # Keep request parsing outside this context: business errors never retry.
            async with getattr(session, method.lower())(node + suffix, **kwargs) as response:
                text = await read_limited_text(response)
                return BufferedResponse(response.status, text)

    async def _probe(self, node, deadline):
        state = self.states[node]
        if not state.failed_until or state.probing or time.monotonic() < state.failed_until:
            return
        state.probing = True
        generation = state.generation
        try:
            remaining = min(2, deadline - time.monotonic())
            if remaining <= 0:
                return
            response = await self._attempt(node, 'GET', '/test/version', remaining, allow_redirects=False)
            data = json.loads(response._bytes)
            if response.status != 200 or not isinstance(data, dict) or str(data.get('code')) != '200':
                raise ValueError('health probe failed')
            if state.generation == generation:
                state.failed_until = 0
                logger.info('worktool_node_recovered node=%s', node)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            self._fail(node, 'health_probe_failed')
        finally:
            state.probing = False

    @asynccontextmanager
    async def request(self, method, url, **kwargs):
        primary, fallback = self.nodes
        if not url.startswith(primary + '/'):
            raise ValueError('Request URL is outside the WorkTool base')
        if kwargs.get('allow_redirects') is not False:
            raise ValueError('WorkTool redirects must be disabled')
        suffix = url[len(primary):]
        deadline = time.monotonic() + (self.timeout.total or 10)
        # Probe recovery with a GET, never with a user write; one probe per node.
        for node in self.nodes:
            await self._probe(node, deadline)
        candidates = [n for n in self.nodes if not self.states[n].failed_until]
        if not candidates:
            raise HTTPException(status_code=503, detail='WorkTool 主备节点暂不可用，请稍后重试')
        readonly = method == 'GET'
        response = None
        for index, node in enumerate(candidates):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise asyncio.TimeoutError()
            if node == fallback:
                logger.info('worktool_fallback_request method=%s path=%s node=%s', method, suffix.split('?')[0], node)
            try:
                response = await self._attempt(node, method, suffix, remaining, **kwargs)
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                # Connector failures/timeouts happen before the request is sent.
                # TLS certificate errors are configuration errors, not failover.
                if isinstance(exc, (aiohttp.ClientSSLError, aiohttp.ServerFingerprintMismatch)):
                    raise
                before_send = isinstance(exc, (aiohttp.ClientConnectorError, aiohttp.ConnectionTimeoutError))
                self._fail(node, type(exc).__name__)
                if not readonly and not before_send:
                    raise HTTPException(status_code=502, detail='WorkTool 操作结果暂未确认，未自动重发，请核实执行结果') from exc
                if index + 1 < len(candidates) and time.monotonic() < deadline:
                    continue
                raise
            if response.status in RETRY_STATUSES:
                self._fail(node, 'http_' + str(response.status))
                if not readonly:
                    raise HTTPException(status_code=502, detail='WorkTool 操作结果暂未确认，未自动重发，请核实执行结果')
                if index + 1 < len(candidates) and time.monotonic() < deadline:
                    continue
            break
        # Yield outside the retry loop so caller exceptions cannot cause a replay.
        yield response

    def get(self, url, **kwargs):
        return self.request('GET', url, **kwargs)

    def post(self, url, **kwargs):
        return self.request('POST', url, **kwargs)


@asynccontextmanager
async def worktool_session(timeout, *, primary, deployment_mode, session_factory=None):
    factory = session_factory or safe_outbound_session
    fallback = os.getenv('WORKTOOL_API_FALLBACK_BASE', '').strip()
    if not fallback or normalize_base(fallback) == normalize_base(primary):
        # No fallback configured: preserve the existing single-node behavior.
        async with factory(timeout, deployment_mode=deployment_mode) as session:
            yield session
        return
    yield WorktoolSession(primary, fallback, timeout, deployment_mode, factory)
