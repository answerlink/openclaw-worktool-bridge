import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import worktool_troubleshoot as troubleshoot


class WorktoolHttpErrorTests(unittest.IsolatedAsyncioTestCase):
    async def call_with_error(self, module, error):
        response_context = MagicMock()
        response_context.__aenter__ = AsyncMock(side_effect=error)
        session = MagicMock()
        session.get.return_value = response_context
        session_context = MagicMock()
        session_context.__aenter__ = AsyncMock(return_value=session)
        with patch.object(module, 'safe_outbound_session', return_value=session_context), patch.object(main, 'get_worktool_api_base', return_value='https://example.com'):
            if module is main:
                return await main.fetch_worktool_api('/robot/qaLog/list', {})
            return await troubleshoot._fetch_worktool_api_loose('https://example.com', '/wework/listRawMessage', {})

    async def test_timeouts_return_actionable_504(self):
        for module in (main, troubleshoot):
            with self.subTest(module=module.__name__), self.assertRaises(HTTPException) as ctx:
                await self.call_with_error(module, asyncio.TimeoutError())
            self.assertEqual(ctx.exception.status_code, 504)
            self.assertIn('上游查询超时', ctx.exception.detail)

    async def test_transport_failures_return_502_without_connection_details(self):
        for module in (main, troubleshoot):
            with self.subTest(module=module.__name__), self.assertRaises(HTTPException) as ctx:
                await self.call_with_error(module, aiohttp.ClientConnectionError('private connection details'))
            self.assertEqual(ctx.exception.status_code, 502)
            self.assertNotIn('private connection details', ctx.exception.detail)

    async def test_existing_http_errors_are_preserved(self):
        for module in (main, troubleshoot):
            with self.subTest(module=module.__name__), self.assertRaises(HTTPException) as ctx:
                await self.call_with_error(module, HTTPException(502, 'upstream HTTP 503'))
            self.assertEqual(ctx.exception.detail, 'upstream HTTP 503')

    async def test_cancellation_is_not_swallowed(self):
        for module in (main, troubleshoot):
            with self.subTest(module=module.__name__), self.assertRaises(asyncio.CancelledError):
                await self.call_with_error(module, asyncio.CancelledError())


class RawCommandsErrorResponseTests(unittest.TestCase):
    def test_timeout_is_json_504_instead_of_unhandled_500(self):
        response_context = MagicMock()
        response_context.__aenter__ = AsyncMock(side_effect=asyncio.TimeoutError())
        session = MagicMock()
        session.get.return_value = response_context
        session_context = MagicMock()
        session_context.__aenter__ = AsyncMock(return_value=session)
        main.app.dependency_overrides[main.get_current_user] = lambda: {'id': 1}
        try:
            with patch.object(main, 'safe_outbound_session', return_value=session_context), patch.object(main, 'get_worktool_api_base', return_value='https://example.com'), patch.object(main, '_require_robot_access'):
                response = TestClient(main.app).get('/api/v1/worktool/raw-commands?robot_id=test')
                self.assertEqual(response.status_code, 504)
                self.assertIn('上游查询超时', response.json()['detail'])
        finally:
            main.app.dependency_overrides.pop(main.get_current_user, None)


if __name__ == '__main__':
    unittest.main()
