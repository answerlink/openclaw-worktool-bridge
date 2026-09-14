import unittest
from unittest.mock import patch

import main


class _Cursor:
    def __init__(self, rowcounts):
        self._rowcounts = iter(rowcounts)
        self.rowcount = 0
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params):
        self.executed.append((sql, params))
        if sql.startswith("DELETE FROM"):
            self.rowcount = next(self._rowcounts)

    def fetchone(self):
        return {}


class _Connection:
    def __init__(self, rowcounts):
        self.cursor_instance = _Cursor(rowcounts)
        self.commits = 0

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def close(self):
        pass


class OperationalLogCleanupTests(unittest.TestCase):
    def test_cleanup_uses_bounded_batches_and_only_marks_completed_at_end(self):
        conn = _Connection([main.LOG_CLEANUP_BATCH_SIZE, 12])
        with patch.object(main, "db_conn", return_value=conn):
            result = main.run_operational_log_cleanup_batch()

        self.assertFalse(result["complete"])
        self.assertEqual(result["qa_monitor_logs"], main.LOG_CLEANUP_BATCH_SIZE)
        self.assertEqual(result["message_logs"], 12)
        deletes = [(sql, params) for sql, params in conn.cursor_instance.executed if sql.startswith("DELETE FROM")]
        self.assertEqual(len(deletes), 2)
        self.assertTrue(all("ORDER BY id LIMIT %s" in sql for sql, _ in deletes))
        self.assertFalse(any("INSERT INTO app_settings" in sql for sql, _ in conn.cursor_instance.executed))

    def test_cleanup_marks_completed_when_both_tables_are_below_batch_size(self):
        conn = _Connection([4, 3])
        with patch.object(main, "db_conn", return_value=conn):
            result = main.run_operational_log_cleanup_batch()

        self.assertTrue(result["complete"])
        self.assertTrue(any("INSERT INTO app_settings" in sql for sql, _ in conn.cursor_instance.executed))


if __name__ == "__main__":
    unittest.main()
