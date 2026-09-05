import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import main


class WorkToolRobotValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_robot_is_accepted(self):
        response = {"code": 200, "message": "操作成功", "data": {"robotId": "20260300"}}
        with patch.object(main, "fetch_worktool_api", new=AsyncMock(return_value=response)) as fetch:
            data = await main.validate_worktool_robot_exists("20260300")

        self.assertEqual(data["robotId"], "20260300")
        fetch.assert_awaited_once_with("/robot/robotInfo/get-detail", {"robotId": "20260300"})

    async def test_missing_robot_is_rejected(self):
        response = {"code": 500, "message": "机器人编号不存在"}
        with patch.object(main, "fetch_worktool_api", new=AsyncMock(return_value=response)):
            with self.assertRaises(HTTPException) as ctx:
                await main.validate_worktool_robot_exists("111")

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("机器人编号不存在", str(ctx.exception.detail))

    async def test_empty_or_mismatched_robot_data_is_rejected(self):
        for response in (
            {"code": 200, "message": "操作成功", "data": {}},
            {"code": 200, "message": "操作成功", "data": {"robotId": "other"}},
        ):
            with self.subTest(response=response):
                with patch.object(main, "fetch_worktool_api", new=AsyncMock(return_value=response)):
                    with self.assertRaises(HTTPException) as ctx:
                        await main.validate_worktool_robot_exists("20260300")
                self.assertEqual(ctx.exception.status_code, 400)

    async def test_worktool_transport_failure_is_not_treated_as_missing_robot(self):
        error = HTTPException(status_code=502, detail="worktool request failed")
        with patch.object(main, "fetch_worktool_api", new=AsyncMock(side_effect=error)):
            with self.assertRaises(HTTPException) as ctx:
                await main.validate_worktool_robot_exists("20260300")
        self.assertEqual(ctx.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
