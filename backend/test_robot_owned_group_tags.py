import unittest
from unittest.mock import patch

import main


class _Cursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.executed = []
        self.rowcount = 1

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=()):
        self.executed.append((" ".join(sql.split()), params))

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class _Connection:
    def __init__(self, rows=None):
        self.cursor_instance = _Cursor(rows)
        self.commits = 0

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commits += 1

    def close(self):
        pass


class RobotOwnedGroupTagTests(unittest.IsolatedAsyncioTestCase):
    async def test_unbinding_robot_does_not_delete_robot_record(self):
        conn = _Connection()
        robot = {"id": 42, "robot_id": "robot-1"}
        with patch.object(main, "_require_robot_access", return_value=robot), patch.object(main, "db_conn", return_value=conn):
            result = await main.delete_robot("robot-1", {"id": 7})

        self.assertTrue(result["ok"])
        statements = conn.cursor_instance.executed
        self.assertEqual(len(statements), 1)
        self.assertIn("DELETE FROM user_robots", statements[0][0])
        self.assertNotIn("DELETE FROM robots", statements[0][0])

    async def test_deleting_tag_explicitly_deletes_items_without_foreign_key(self):
        conn = _Connection()
        robot = {"id": 42, "robot_id": "robot-1"}
        with (
            patch.object(main, "_require_robot_access", return_value=robot),
            patch.object(main, "_reject_demo_robot_write"),
            patch.object(main, "_get_group_tag_or_404", return_value={"id": 9}),
            patch.object(main, "db_conn", return_value=conn),
        ):
            result = await main.delete_group_tag(9, "robot-1", {"id": 7})

        self.assertTrue(result["ok"])
        statements = [sql for sql, _ in conn.cursor_instance.executed]
        self.assertEqual(statements, ["DELETE FROM group_tag_items WHERE tag_id=%s", "DELETE FROM group_tags WHERE id=%s AND robot_pk=%s"])

    def test_tag_lookup_is_scoped_by_robot_not_creator(self):
        conn = _Connection([{"id": 9, "robot_pk": 42, "created_by": 7}])
        with patch.object(main, "db_conn", return_value=conn):
            row = main._get_group_tag_or_404(9, 42)

        self.assertEqual(row["id"], 9)
        sql, params = conn.cursor_instance.executed[0]
        self.assertIn("id=%s AND robot_pk=%s", sql)
        self.assertNotIn("created_by", sql)
        self.assertEqual(params, (9, 42))


if __name__ == "__main__":
    unittest.main()
