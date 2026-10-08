import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import main


class ReadGroupsFromClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_dispatches_508_with_exact_payload(self):
        with patch.object(main, '_require_robot_access') as access, patch.object(main, '_reject_demo_robot_write'), patch.object(main, 'post_worktool_api', new=AsyncMock(return_value={'code': 200})) as post:
            result = await main.read_groups_from_client(' robot-1 ', {'id': 7})
            access.assert_called_once_with(7, 'robot-1')
            post.assert_awaited_once_with('/wework/sendRawMessage', params={'robotId': 'robot-1'}, body={'socketType': 2, 'list': [{'type': 508}]})
            self.assertTrue(result['ok'])

    async def test_permission_rejection_never_dispatches(self):
        for guard in ('_require_robot_access', '_reject_demo_robot_write'):
            with self.subTest(guard=guard), patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, guard, side_effect=HTTPException(403, 'denied')), patch.object(main, 'post_worktool_api', new=AsyncMock()) as post:
                with self.assertRaises(HTTPException):
                    await main.read_groups_from_client('robot-1', {'id': 7})
                post.assert_not_awaited()

    async def test_failed_dispatch_does_not_report_success(self):
        for failure in ({'code': 500, 'message': 'failed'}, TimeoutError()):
            post_mock = AsyncMock(side_effect=failure) if isinstance(failure, Exception) else AsyncMock(return_value=failure)
            with self.subTest(failure=failure), patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, 'post_worktool_api', new=post_mock):
                with self.assertRaises(HTTPException):
                    await main.read_groups_from_client('robot-1', {'id': 7})
                self.assertEqual(post_mock.await_count, 1)
