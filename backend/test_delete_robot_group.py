import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
import main


class DeleteRobotGroupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.conn = MagicMock()
        self.cur = self.conn.cursor.return_value.__enter__.return_value
        self.cur.fetchone.return_value = {'raw_json': json.dumps({'groupName': ' 原始群名 '})}
        self.mocks = {}
        for name in ('_require_robot_access', '_reject_demo_robot_write', 'db_conn', 'post_worktool_api'):
            p = patch.object(main, name, new_callable=AsyncMock if name == 'post_worktool_api' else MagicMock)
            self.mocks[name] = p.start()
            self.addCleanup(p.stop)
        self.mocks['_require_robot_access'].return_value = {'id': 42}
        self.mocks['db_conn'].return_value = self.conn
        self.mocks['post_worktool_api'].return_value = {'code': 200, 'data': {'deletedCount': 3}}

    async def delete(self, name='原始群名'):
        return await main.delete_robot_group(main.GroupDeleteRequest(robot_id=' robot-1 ', group_name=name), {'id': 7})

    async def test_exact_upstream_name_count_and_scoped_cache_cleanup(self):
        result = await self.delete()
        self.assertEqual(result['deletedCount'], 3)
        self.mocks['_require_robot_access'].assert_called_once_with(7, 'robot-1')
        self.mocks['post_worktool_api'].assert_awaited_once_with('/robot/wework/group/delete', params={'robotId': 'robot-1', 'groupName': ' 原始群名 '})
        self.cur.execute.assert_called_with('DELETE FROM robot_group_cache WHERE robot_pk=%s AND group_name=%s', (42, '原始群名'))
        self.conn.commit.assert_called_once()

    async def test_zero_matches_cleans_stale_cache(self):
        self.mocks['post_worktool_api'].return_value = {'code': 200, 'data': {'deletedCount': 0}}
        self.assertEqual((await self.delete())['deletedCount'], 0)
        self.conn.commit.assert_called_once()

    async def test_access_and_demo_guards(self):
        for guard in ('_require_robot_access', '_reject_demo_robot_write'):
            with self.subTest(guard=guard):
                self.mocks[guard].side_effect = HTTPException(403)
                with self.assertRaises(HTTPException):
                    await self.delete()
                self.mocks[guard].side_effect = None
        self.mocks['post_worktool_api'].assert_not_awaited()
        self.mocks['db_conn'].assert_not_called()

    async def test_blank_name_rejected(self):
        with self.assertRaises(HTTPException):
            await self.delete('  ')
        self.mocks['post_worktool_api'].assert_not_awaited()

    async def test_missing_or_invalid_cache_never_deletes(self):
        for row in (None, {'raw_json': '{}'}, {'raw_json': '{invalid'}):
            self.cur.fetchone.return_value = row
            with self.subTest(row=row), self.assertRaises(HTTPException):
                await self.delete()
        self.mocks['post_worktool_api'].assert_not_awaited()

    async def test_failed_or_unconfirmed_upstream_preserves_cache(self):
        for upstream in ({'code': 500, 'message': 'failed'}, {'code': 200, 'data': {}}, {'code': 200, 'data': {'deletedCount': True}}, {'code': 200, 'data': {'deletedCount': -1}}):
            self.mocks['post_worktool_api'].return_value = upstream
            with self.subTest(upstream=upstream), self.assertRaises(HTTPException):
                await self.delete()
        self.conn.commit.assert_not_called()
        self.assertTrue(all(call.args[0].startswith('SELECT') for call in self.cur.execute.call_args_list))

    async def test_timeout_is_unknown_and_preserves_cache(self):
        self.mocks['post_worktool_api'].side_effect = asyncio.TimeoutError
        with self.assertRaises(HTTPException) as error:
            await self.delete()
        self.assertEqual(error.exception.status_code, 504)
        self.conn.commit.assert_not_called()

    async def test_cache_failure_reports_upstream_success(self):
        self.cur.execute.side_effect = [None, RuntimeError('db unavailable')]
        with self.assertRaises(HTTPException) as error:
            await self.delete()
        self.assertIn('已删除 3 条', error.exception.detail)
        self.conn.rollback.assert_called_once()


if __name__ == '__main__':
    unittest.main()
