import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import main
from worktool_troubleshoot import build_robot_status


class RobotStatusTests(unittest.IsolatedAsyncioTestCase):
    def test_fields_and_fallbacks(self):
        status = build_robot_status('robot', {'authExpire': '2027-01-01', 'robotType': 4}, False)
        self.assertEqual(len(status), 13)
        self.assertEqual(status['机器人ID'], 'robot')
        self.assertEqual(status['授权到期'], '2027-01-01')
        self.assertEqual(status['WorkTool版本'], '-')
        self.assertFalse(status['当前在线'])
        self.assertFalse(status['是否有效'])

    async def test_status_uses_only_detail_and_online(self):
        with patch.object(main, '_require_admin'), patch.object(
            main, 'fetch_worktool_api', new_callable=AsyncMock,
            side_effect=[{'data': {'name': '助理', 'workToolVersion': '3.8.2.3'}}, {'data': False}],
        ) as fetch:
            result = await main.admin_client_log_robot_status(' robot ', {})
        self.assertEqual(result['机器人名称'], '助理')
        self.assertEqual(result['WorkTool版本'], '3.8.2.3')
        self.assertFalse(result['当前在线'])
        self.assertEqual(fetch.await_count, 2)
        self.assertEqual(fetch.await_args_list[0].args[1], {'robotId': 'robot'})

    async def test_missing_data_is_not_shown_as_offline(self):
        for responses in ([{'data': {}}], [{'data': {'name': '助理'}}, {'data': None}]):
            with patch.object(main, '_require_admin'), patch.object(
                main, 'fetch_worktool_api', new_callable=AsyncMock, side_effect=responses,
            ), self.assertRaises(HTTPException) as ctx:
                await main.admin_client_log_robot_status('robot', {})
            self.assertEqual(ctx.exception.status_code, 502)

    async def test_empty_robot_is_rejected(self):
        with patch.object(main, '_require_admin'), self.assertRaises(HTTPException) as ctx:
            await main.admin_client_log_robot_status(' ', {})
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_admin_required(self):
        with patch.object(main, '_require_admin', side_effect=HTTPException(403)), patch.object(
            main, 'fetch_worktool_api', new_callable=AsyncMock,
        ) as fetch, self.assertRaises(HTTPException):
            await main.admin_client_log_robot_status('robot', {})
        fetch.assert_not_awaited()
