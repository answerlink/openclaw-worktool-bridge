import ipaddress
import os
import socket
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Union

import aiohttp
from aiohttp.abc import AbstractResolver
from aiohttp.resolver import DefaultResolver
from yarl import URL


VALID_DEPLOYMENT_MODES = {"saas", "private"}
DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class UnsafeOutboundUrlError(ValueError):
    pass


def get_deployment_mode() -> str:
    mode = os.getenv("APP_DEPLOYMENT_MODE", "private").strip().lower() or "private"
    if mode not in VALID_DEPLOYMENT_MODES:
        raise RuntimeError("APP_DEPLOYMENT_MODE must be 'saas' or 'private'")
    return mode


def allow_private_loopback() -> bool:
    return os.getenv("PRIVATE_OUTBOUND_ALLOW_LOOPBACK", "false").strip().lower() in {"1", "true", "yes", "on"}


def validate_outbound_url_shape(value: str) -> URL:
    raw = (value or "").strip()
    if not raw:
        raise UnsafeOutboundUrlError("URL 不能为空")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in raw):
        raise UnsafeOutboundUrlError("URL 包含非法控制字符")
    try:
        parsed = URL(raw)
    except Exception as exc:
        raise UnsafeOutboundUrlError("URL 格式不正确") from exc
    if parsed.scheme.lower() not in {"http", "https"}:
        raise UnsafeOutboundUrlError("仅支持 HTTP/HTTPS URL")
    if not parsed.host:
        raise UnsafeOutboundUrlError("URL 缺少主机名")
    if parsed.user is not None or parsed.password is not None:
        raise UnsafeOutboundUrlError("URL 不允许携带用户名或密码")
    if parsed.fragment:
        raise UnsafeOutboundUrlError("URL 不允许携带 fragment")
    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsafeOutboundUrlError("URL 端口不正确") from exc
    if port is not None and not 1 <= port <= 65535:
        raise UnsafeOutboundUrlError("URL 端口不正确")
    return parsed


def _normalized_ip(value: str) -> Union[ipaddress.IPv4Address, ipaddress.IPv6Address]:
    address = ipaddress.ip_address(value.split("%", 1)[0])
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def is_ip_allowed(value: str, deployment_mode: str, private_loopback_allowed: bool = False) -> bool:
    try:
        address = _normalized_ip(value)
    except ValueError:
        return False
    if deployment_mode == "saas":
        return bool(address.is_global)
    if deployment_mode != "private":
        return False
    if address.is_unspecified or address.is_multicast or address.is_link_local or address.is_reserved:
        return False
    if address.is_loopback:
        return private_loopback_allowed
    return True


def validate_resolved_addresses(
    results: List[Dict[str, Any]],
    deployment_mode: str,
    private_loopback_allowed: bool = False,
) -> None:
    if not results:
        raise UnsafeOutboundUrlError("目标域名没有可用地址")
    for result in results:
        address = str(result.get("host") or "").strip()
        if not is_ip_allowed(address, deployment_mode, private_loopback_allowed):
            if deployment_mode == "saas":
                raise UnsafeOutboundUrlError("SaaS 模式禁止访问非公网地址")
            raise UnsafeOutboundUrlError("私有化模式禁止访问回环、链路本地、保留或组播地址")


class PolicyResolver(AbstractResolver):
    def __init__(
        self,
        deployment_mode: Optional[str] = None,
        private_loopback_allowed: Optional[bool] = None,
        resolver: Optional[AbstractResolver] = None,
    ) -> None:
        self.deployment_mode = deployment_mode or get_deployment_mode()
        self.private_loopback_allowed = allow_private_loopback() if private_loopback_allowed is None else private_loopback_allowed
        self._resolver = resolver or DefaultResolver()

    async def resolve(
        self,
        host: str,
        port: int = 0,
        family: socket.AddressFamily = socket.AF_UNSPEC,
    ) -> List[Dict[str, Any]]:
        try:
            direct_ip = _normalized_ip(host)
        except ValueError:
            direct_ip = None
        if direct_ip is not None:
            results: List[Dict[str, Any]] = [
                {
                    "hostname": host,
                    "host": str(direct_ip),
                    "port": port,
                    "family": socket.AF_INET6 if direct_ip.version == 6 else socket.AF_INET,
                    "proto": 0,
                    "flags": 0,
                }
            ]
        else:
            results = await self._resolver.resolve(host, port, family)
        validate_resolved_addresses(results, self.deployment_mode, self.private_loopback_allowed)
        return results

    async def close(self) -> None:
        await self._resolver.close()


async def validate_outbound_url(value: str, deployment_mode: Optional[str] = None) -> str:
    parsed = validate_outbound_url_shape(value)
    resolver = PolicyResolver(deployment_mode=deployment_mode)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        await resolver.resolve(parsed.host or "", port)
    except UnsafeOutboundUrlError:
        raise
    except Exception as exc:
        raise UnsafeOutboundUrlError("目标域名解析失败") from exc
    finally:
        await resolver.close()
    return str(parsed)


@asynccontextmanager
async def safe_outbound_session(timeout: aiohttp.ClientTimeout, deployment_mode: Optional[str] = None):
    async def reject_redirect(
        session: aiohttp.ClientSession,
        trace_config_ctx: Any,
        params: Any,
    ) -> None:
        _ = session, trace_config_ctx, params
        raise UnsafeOutboundUrlError("禁止跟随上游重定向")

    trace_config = aiohttp.TraceConfig()
    trace_config.on_request_redirect.append(reject_redirect)
    connector = aiohttp.TCPConnector(
        resolver=PolicyResolver(deployment_mode=deployment_mode),
        use_dns_cache=False,
    )
    async with aiohttp.ClientSession(timeout=timeout, connector=connector, trace_configs=[trace_config]) as session:
        yield session


async def read_limited_text(response: aiohttp.ClientResponse, max_bytes: int = DEFAULT_MAX_RESPONSE_BYTES) -> str:
    content_length = response.content_length
    if content_length is not None and content_length > max_bytes:
        raise UnsafeOutboundUrlError("上游响应体过大")
    data = await response.content.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise UnsafeOutboundUrlError("上游响应体过大")
    encoding = response.charset or "utf-8"
    try:
        return data.decode(encoding, errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")
