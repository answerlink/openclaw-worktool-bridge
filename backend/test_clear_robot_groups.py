import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
import main


class ClearRobotGroupsTests(unittest.IsolatedAsyncioTestCase):
    async def test_posts_robot_id_without_body_and_returns_count(self):
        for upstream in ({'code': 200, 'data': {'groupDeletedCount': 12}}, {'groupDeletedCount': 0}):
            with self.subTest(upstream=upstream), patch.object(main, '_require_robot_access', return_value={'id': 42}) as access, patch.object(main, '_reject_demo_robot_write'), patch.object(main, 'post_worktool_api', new=AsyncMock(return_value=upstream)) as post, patch.object(main, 'db_conn', return_value=MagicMock()) as connect:
                result = await main.clear_robot_groups(' robot-1 ', {'id': 7})
                access.assert_called_once_with(7, 'robot-1')
                post.assert_awaited_once_with('/robot/robotInfo/clearGroupList', params={'robotId': 'robot-1'})
                self.assertEqual(result['groupDeletedCount'], upstream.get('data', upstream)['groupDeletedCount'])
                conn = connect.return_value
                queries = conn.cursor.return_value.__enter__.return_value.execute.call_args_list
                self.assertEqual([(c.args[0], c.args[1]) for c in queries], [
                    ('DELETE FROM robot_group_cache WHERE robot_pk=%s', (42,)),
                    ('DELETE FROM robot_group_sync_state WHERE robot_pk=%s', (42,)),
                ])
                conn.commit.assert_called_once()
                conn.close.assert_called_once()

    async def test_access_and_demo_rejections_never_call_worktool(self):
        for guard in ('_require_robot_access', '_reject_demo_robot_write'):
            with self.subTest(guard=guard), patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, guard, side_effect=HTTPException(403, 'denied')), patch.object(main, 'post_worktool_api', new=AsyncMock()) as post:
                with self.assertRaises(HTTPException) as error:
                    await main.clear_robot_groups('robot-1', {'id': 7})
                self.assertEqual(error.exception.status_code, 403)
                post.assert_not_awaited()

    async def test_upstream_failure_and_missing_counts_are_not_success(self):
        for upstream in ({'code': 500, 'message': 'failed'}, {'code': 200, 'data': {}}, {'groupDeletedCount': -1}):
            with self.subTest(upstream=upstream), patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, 'post_worktool_api', new=AsyncMock(return_value=upstream)):
                with self.assertRaises(HTTPException):
                    await main.clear_robot_groups('robot-1', {'id': 7})

    async def test_timeout_does_not_report_success(self):
        with patch.object(main, '_require_robot_access'), patch.object(main, '_reject_demo_robot_write'), patch.object(main, 'post_worktool_api', new=AsyncMock(side_effect=TimeoutError)):
            with self.assertRaises(HTTPException) as error:
                await main.clear_robot_groups('robot-1', {'id': 7})
            self.assertEqual(error.exception.status_code, 504)
