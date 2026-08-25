import unittest
from unittest.mock import AsyncMock, patch

import main


class FakeCursor:
    def __init__(self):
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=()):
        self.statements.append((" ".join(sql.split()), tuple(params)))

    def fetchone(self):
        return {"id": 34, "robot_id": "111", "name": "机器人"}


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


class RobotCsvExistingTest(unittest.IsolatedAsyncioTestCase):
    async def test_csv_import_updates_existing_robot_name(self):
        conn = FakeConnection()
        body = main.RobotCreate(robot_id="111", name="r111", update_name_if_exists=True)
        with (
            patch.object(main, "db_conn", return_value=conn),
            patch.object(main, "get_setting", return_value="false"),
            patch.object(main, "ensure_default_message_callback", new=AsyncMock(return_value={"callback_status": "skipped"})),
        ):
            result = await main.create_robot(body, {"id": 1, "phone": "admin"})

        updates = [(sql, params) for sql, params in conn.cursor_instance.statements if sql.startswith("UPDATE robots SET name=")]
        self.assertEqual(updates, [("UPDATE robots SET name=%s WHERE id=%s", ("r111", 34))])
        self.assertTrue(result["existed"])
        self.assertTrue(result["name_updated"])

    async def test_manual_add_keeps_existing_robot_name(self):
        conn = FakeConnection()
        body = main.RobotCreate(robot_id="111", name="机器人")
        with (
            patch.object(main, "db_conn", return_value=conn),
            patch.object(main, "get_setting", return_value="false"),
            patch.object(main, "ensure_default_message_callback", new=AsyncMock(return_value={"callback_status": "skipped"})),
        ):
            result = await main.create_robot(body, {"id": 1, "phone": "admin"})

        self.assertFalse(any(sql.startswith("UPDATE robots SET name=") for sql, _ in conn.cursor_instance.statements))
        self.assertFalse(result["name_updated"])


if __name__ == "__main__":
    unittest.main()
