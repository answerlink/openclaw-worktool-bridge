import sqlite3
import unittest
import re
from datetime import datetime
from unittest.mock import Mock, patch

import command_tasks
from command_tasks import list_command_tasks


class Cursor:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, sql, params=()):
        if sql.startswith(("SET TRANSACTION", "START TRANSACTION")):
            return
        sql = re.sub(r"FORCE INDEX\([a-z0-9_]+\)", "", sql)
        self.result = self.db.execute(sql.replace("%s", "?"), params)

    def fetchone(self):
        return dict(self.result.fetchone())

    def fetchall(self):
        return [dict(row) for row in self.result.fetchall()]


class Connection:
    def __init__(self, db):
        self.db = db

    def cursor(self):
        return Cursor(self.db)

    def close(self):
        pass


class CommandTaskTests(unittest.TestCase):
    def setUp(self):
        clock = patch('command_tasks.datetime').start()
        clock.now.return_value = datetime(2026, 9, 15, 12)
        self.addCleanup(patch.stopall)
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE raw_message_record (
                id INTEGER PRIMARY KEY, robot_id TEXT, message_id TEXT,
                create_time TEXT, body TEXT, type_list TEXT, ip TEXT);
            CREATE TABLE raw_msg_confirm (
                id INTEGER PRIMARY KEY, robot_id TEXT, message_id TEXT,
                run_time TEXT, raw_success INTEGER, error_reason TEXT,
                type INTEGER, success_list TEXT, fail_list TEXT, time_cost REAL);
        ''')
        for id, robot, mid in [(1, 'a', 'retry'), (2, 'a', 'failed'), (3, 'a', 'pending'), (4, 'b', 'retry')]:
            self.db.execute("INSERT INTO raw_message_record VALUES (?,?,?,?,?,?,?)",
                            (id, robot, mid, f'2026-09-15 10:00:0{id}', '{"list":[{"receivedContent":"original"}]}', '203', ''))
        for id, robot, mid, time, status in [
            (1, 'a', 'retry', '11:00:00', 99),
            (2, 'a', 'retry', '11:01:00', 0),
            (3, 'a', 'failed', '11:02:00', 0),
            (4, 'a', 'failed', '11:02:00', 88),
            (5, 'b', 'retry', '12:00:00', 77),
            (6, 'a', 'retry', '10:59:00', 66),
        ]:
            self.db.execute("INSERT INTO raw_msg_confirm VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (id, robot, mid, '2026-09-15 ' + time, status, 'reason', 203, '[]', '[]', 1))

    def tearDown(self):
        self.db.close()

    def query(self, status='all', page=1, size=30, mid=''):
        return list_command_tasks(lambda: Connection(self.db), 'a', status, page, size, mid)

    def test_latest_receipt_before_status_filter_and_robot_isolation(self):
        success = self.query('success')
        failed = self.query('failed')
        self.assertEqual(success['total'], 1)
        self.assertEqual(success['items'][0]['command']['messageId'], 'retry')
        self.assertEqual(success['items'][0]['result']['rawSuccess'], 0)
        self.assertIn('original', success['items'][0]['command']['body'])
        self.assertEqual(failed['total'], 1)
        self.assertEqual(failed['items'][0]['result']['rawSuccess'], 88)

    def test_all_pages_are_contiguous_and_include_pending(self):
        first, second = self.query(page=1, size=2), self.query(page=2, size=2)
        self.assertEqual(first['total'], 3)
        self.assertEqual(second['total'], 3)
        items = first['items'] + second['items']
        self.assertEqual([x['command']['messageId'] for x in items], ['pending', 'failed', 'retry'])
        self.assertIsNone(items[0]['result'])

    def test_exact_message_query_combines_with_status_and_empty_pages(self):
        self.assertEqual(self.query('failed', mid='retry')['total'], 0)
        self.assertEqual(self.query('success', mid='retry')['total'], 1)
        self.assertEqual(self.query('success', page=2, size=1)['items'], [])

    def test_old_commands_excluded_even_with_recent_receipts_and_exact_lookup(self):
        self.db.execute("UPDATE raw_message_record SET create_time='2026-09-13 11:59:59' WHERE message_id='retry'")
        self.assertEqual(self.query()['total'], 2)
        self.assertEqual(self.query('success')['total'], 0)
        self.assertEqual(self.query(mid='retry')['total'], 0)

    def test_limit_is_applied_before_status_and_exact_filter(self):
        with patch.object(command_tasks, 'MAX_COMMANDS', 2):
            self.assertEqual(self.query()['total'], 2)
            self.assertEqual(self.query('success')['total'], 0)
            self.assertEqual(self.query('failed')['total'], 1)
            self.assertEqual(self.query(mid='retry')['total'], 0)
            self.assertEqual(self.query(page=3, size=1)['items'], [])

    def test_time_boundary_inclusive(self):
        self.db.execute("UPDATE raw_message_record SET create_time='2026-09-13 12:00:00' WHERE message_id='retry'")
        self.assertEqual(self.query('success')['total'], 1)

    def test_busy_queries_do_not_open_a_connection_and_slots_released_on_failure(self):
        slots = command_tasks._query_slots
        for _ in range(4):
            self.assertTrue(slots.acquire(blocking=False))
        connect = Mock()
        try:
            with self.assertRaises(command_tasks.CommandQueryBusy):
                list_command_tasks(connect, 'a', 'all', 1, 30)
            connect.assert_not_called()
        finally:
            for _ in range(4):
                slots.release()
        connect.side_effect = RuntimeError('connection failed')
        with self.assertRaises(RuntimeError):
            list_command_tasks(connect, 'a', 'all', 1, 30)
        # Every slot must remain available after a database exception.
        acquired = [slots.acquire(blocking=False) for _ in range(4)]
        for success in acquired:
            if success:
                slots.release()
        self.assertTrue(all(acquired))


if __name__ == '__main__':
    unittest.main()
