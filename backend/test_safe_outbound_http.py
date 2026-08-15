import os
import socket
import unittest
from unittest.mock import patch

import aiohttp
from aiohttp import web

from safe_outbound_http import (
    PolicyResolver,
    UnsafeOutboundUrlError,
    is_ip_allowed,
    safe_outbound_session,
    validate_outbound_url_shape,
)


class FakeResolver:
    def __init__(self, addresses):
        self.addresses = addresses

    async def resolve(self, host, port=0, family=socket.AF_UNSPEC):
        return [
            {
                "hostname": host,
                "host": address,
                "port": port,
                "family": socket.AF_INET6 if ":" in address else socket.AF_INET,
                "proto": 0,
                "flags": 0,
            }
            for address in self.addresses
        ]

    async def close(self):
        return None


class OutboundUrlShapeTests(unittest.TestCase):
    def test_http_and_https_are_allowed(self):
        self.assertEqual(validate_outbound_url_shape("http://example.com:8080/api").scheme, "http")
        self.assertEqual(validate_outbound_url_shape("https://example.com/api").scheme, "https")

    def test_non_http_credentials_and_fragment_are_rejected(self):
        for value in (
            "file:///etc/passwd",
            "gopher://example.com",
            "http://user:pass@example.com",
            "https://example.com/path#fragment",
        ):
            with self.subTest(value=value), self.assertRaises(UnsafeOutboundUrlError):
                validate_outbound_url_shape(value)


class AddressPolicyTests(unittest.TestCase):
    def test_saas_allows_only_global_addresses(self):
        self.assertTrue(is_ip_allowed("8.8.8.8", "saas"))
        for address in ("127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"):
            with self.subTest(address=address):
                self.assertFalse(is_ip_allowed(address, "saas"))

    def test_private_allows_rfc1918_but_blocks_metadata_and_loopback_by_default(self):
        self.assertTrue(is_ip_allowed("10.0.0.1", "private"))
        self.assertTrue(is_ip_allowed("192.168.1.1", "private"))
        self.assertFalse(is_ip_allowed("169.254.169.254", "private"))
        self.assertFalse(is_ip_allowed("127.0.0.1", "private"))
        self.assertTrue(is_ip_allowed("127.0.0.1", "private", private_loopback_allowed=True))


class ResolverPolicyTests(unittest.IsolatedAsyncioTestCase):
    async def test_saas_rejects_mixed_public_and_private_dns_answers(self):
        resolver = PolicyResolver("saas", resolver=FakeResolver(["8.8.8.8", "10.0.0.1"]))
        with self.assertRaises(UnsafeOutboundUrlError):
            await resolver.resolve("mixed.example", 443)

    async def test_saas_accepts_all_public_dns_answers(self):
        resolver = PolicyResolver("saas", resolver=FakeResolver(["8.8.8.8", "1.1.1.1"]))
        results = await resolver.resolve("public.example", 443)
        self.assertEqual(len(results), 2)

    async def test_private_accepts_private_dns_answers(self):
        resolver = PolicyResolver("private", resolver=FakeResolver(["10.0.0.2"]))
        results = await resolver.resolve("openclaw.internal", 18789)
        self.assertEqual(results[0]["host"], "10.0.0.2")

    async def test_safe_session_blocks_redirect_even_if_caller_forgets_flag(self):
        async def redirect_handler(request):
            _ = request
            raise web.HTTPFound("/target")

        async def target_handler(request):
            _ = request
            return web.Response(text="should not be reached")

        app = web.Application()
        app.router.add_get("/start", redirect_handler)
        app.router.add_get("/target", target_handler)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            with patch.dict(os.environ, {"PRIVATE_OUTBOUND_ALLOW_LOOPBACK": "true"}):
                timeout = aiohttp.ClientTimeout(total=2)
                async with safe_outbound_session(timeout, deployment_mode="private") as session:
                    with self.assertRaises(UnsafeOutboundUrlError):
                        await session.get(f"http://127.0.0.1:{port}/start")
        finally:
            await runner.cleanup()


if __name__ == "__main__":
    unittest.main()
