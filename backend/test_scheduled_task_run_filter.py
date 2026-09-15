import unittest
from unittest.mock import patch

import main


class _Cursor:
    def __init__(self):
        self.executed = []
        self._result_index = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=()):
        self.executed.append((" ".join(sql.split()), params))

    def fetchone(self):
        return {"c": 3}

    def fetchall(self):
        return []


class _Connection:
    def __init__(self):
        self.cursor_instance = _Cursor()

    def cursor(self):
        return self.cursor_instance

    def close(self):
        pass


class ScheduledTaskRunFilterTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_status_is_applied_to_count_and_page_queries(self):
        conn = _Connection()
        with (
            patch.object(main, "_get_scheduled_task_or_404", return_value={"id": 9}),
            patch.object(main, "db_conn", return_value=conn),
        ):
            result = await main.list_scheduled_task_runs(9, page=2, page_size=20, status="failed", user={"id": 7})

        self.assertEqual(result["total"], 3)
        count_sql, count_params = conn.cursor_instance.executed[0]
        page_sql, page_params = conn.cursor_instance.executed[1]
        self.assertIn("WHERE task_id=%s AND status=%s", count_sql)
        self.assertIn("WHERE task_id=%s AND status=%s", page_sql)
        self.assertEqual(count_params, (9, "failed"))
        self.assertEqual(page_params, (9, "failed", 20, 20))

    async def test_all_status_does_not_add_status_clause(self):
        conn = _Connection()
        with (
            patch.object(main, "_get_scheduled_task_or_404", return_value={"id": 9}),
            patch.object(main, "db_conn", return_value=conn),
        ):
            await main.list_scheduled_task_runs(9, page=1, page_size=20, status=None, user={"id": 7})

        for sql, params in conn.cursor_instance.executed:
            self.assertNotIn("status=%s", sql)
            self.assertNotIn("failed", params)


if __name__ == "__main__":
    unittest.main()
