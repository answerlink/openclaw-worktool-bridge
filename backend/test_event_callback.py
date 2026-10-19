import asyncio
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
import main


class EventCallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_unconfigured_and_disabled_remain_distinct(self):
        for data, expected in [({'eventCallbackUrl': ''}, None), ({'enabled': False, 'eventCallbackUrl': ''}, False), ({'enabled': True, 'eventCallbackUrl': 'https://example.com/events'}, True)]:
            with patch.object(main, '_require_robot_access') as access, patch.object(main, 'fetch_worktool_api', new=AsyncMock(return_value={'code': 200, 'data': data})) as fetch:
                result = await main.get_robot_event_callback(' robot-1 ', {'id': 7})
                self.assertIs(result['enabled'], expected)
                access.assert_called_once_with(7, 'robot-1')
                fetch.assert_awaited_once_with('/robot/robotInfo/callBack/eventConfig', {'robotId': 'robot-1'})

    async def test_save_blank_inheritance_and_explicit_off(self):
        for enabled in (True, False):
            with patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, '_validate_user_outbound_url', new=AsyncMock()) as validate, patch.object(main, 'post_worktool_api', new=AsyncMock(return_value={'code': 200})) as post:
                result = await main.save_robot_event_callback(main.EventCallbackPayload(robot_id=' robot-1 ', event_callback_url='  ', enabled=enabled), {'id': 7})
                self.assertTrue(result['ok'])
                validate.assert_not_awaited()
                post.assert_awaited_once_with('/robot/robotInfo/callBack/eventConfig', params={'robotId': 'robot-1'}, body={'eventCallbackUrl': '', 'enabled': enabled})

    async def test_custom_url_validated_before_forwarding(self):
        with patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, '_validate_user_outbound_url', new=AsyncMock(return_value='https://example.com/events')) as validate, patch.object(main, 'post_worktool_api', new=AsyncMock(return_value={'code': 200})) as post:
            await main.save_robot_event_callback(main.EventCallbackPayload(robot_id='r', event_callback_url=' https://example.com/events ', enabled=True), {'id': 7})
            validate.assert_awaited_once_with('https://example.com/events')
            self.assertEqual(post.call_args.kwargs['body']['eventCallbackUrl'], 'https://example.com/events')

    async def test_access_demo_and_unsafe_url_rejected_before_write(self):
        for guard in ('_require_robot_access', '_reject_demo_robot_write', '_validate_user_outbound_url'):
            with patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, '_validate_user_outbound_url', new=AsyncMock()), patch.object(main, guard, side_effect=HTTPException(403, 'denied')), patch.object(main, 'post_worktool_api', new=AsyncMock()) as post:
                with self.assertRaises(HTTPException):
                    await main.save_robot_event_callback(main.EventCallbackPayload(robot_id='r', event_callback_url='http://127.0.0.1/', enabled=True), {'id': 7})
                post.assert_not_awaited()

    async def test_failed_or_malformed_reads_never_look_unconfigured(self):
        for result in ({'code': 500, 'message': 'failed'}, {'code': 200}, {'code': 200, 'data': {'enabled': 'false'}}):
            with patch.object(main, '_require_robot_access'), patch.object(main, 'fetch_worktool_api', new=AsyncMock(return_value=result)):
                with self.assertRaises(HTTPException):
                    await main.get_robot_event_callback('r', {'id': 7})

    async def test_failed_write_not_reported_as_success(self):
        with patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, 'post_worktool_api', new=AsyncMock(return_value={'code': 500, 'message': 'failed'})):
            with self.assertRaises(HTTPException):
                await main.save_robot_event_callback(main.EventCallbackPayload(robot_id='r', enabled=False), {'id': 7})

    async def test_timeout_not_retried_or_reported_as_success(self):
        with patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, 'post_worktool_api', new=AsyncMock(side_effect=asyncio.TimeoutError())) as post:
            with self.assertRaises(HTTPException) as error:
                await main.save_robot_event_callback(main.EventCallbackPayload(robot_id='r', enabled=False), {'id': 7})
            self.assertEqual(error.exception.status_code, 504)
            self.assertEqual(post.await_count, 1)


class EventCallbackHttpTests(unittest.TestCase):
    def test_requires_login(self):
        response = TestClient(main.app).get('/api/v1/robot-info/event-callback?robot_id=r')
        self.assertIn(response.status_code, (401, 403))

    def test_requires_switch_and_rejects_long_urls(self):
        main.app.dependency_overrides[main.get_current_user] = lambda: {'id': 7}
        try:
            for body in ({'robot_id': 'r'}, {'robot_id': 'r', 'enabled': True, 'event_callback_url': 'https://example.com/' + 'x' * 2048}):
                response = TestClient(main.app).post('/api/v1/robot-info/event-callback', json=body)
                self.assertEqual(response.status_code, 422)
        finally:
            main.app.dependency_overrides.pop(main.get_current_user, None)
