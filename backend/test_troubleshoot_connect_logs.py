import sqlite3
import unittest
from unittest.mock import patch

from worktool_troubleshoot import _mysql_robot_connect_logs


class ConnectionLogQueryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE robot_log (id INTEGER PRIMARY KEY, robot_id TEXT, log TEXT, ip TEXT, create_time TEXT)')
        self.db.executemany('INSERT INTO robot_log VALUES (?, ?, ?, ?, ?)', [
            (1, 'target', '连接建立 older', '1.1.1.1', '2026-09-15 10:00:00'),
            (2, 'target', '连接建立 Xiaomi', '1.1.1.1', '2026-09-16 00:00:38'),
            (3, 'target', '连接建立 Xiaomi', '2.2.2.2', '2026-09-17 00:00:38'),
            (4, 'target', '连接建立 Xiaomi', '3.3.3.3', '2026-09-17 00:01:13'),
            (5, 'target', '连接关闭', '3.3.3.3', '2026-09-17 00:01:18'),
            (6, 'target', '悬浮窗操作: 主功能暂停', '3.3.3.3', '2026-09-17 13:09:08'),
            (7, 'target', '悬浮窗操作: 主功能继续', '3.3.3.3', '2026-09-17 13:10:41'),
            (8, 'another', '连接建立 Xiaomi', '3.3.3.3', '2026-09-17 13:11:00'),
        ])
        self.query_patch = patch('worktool_troubleshoot._worktool_mysql_query', side_effect=self.query)
        self.query_patch.start()
        self.addCleanup(self.query_patch.stop)
        self.addCleanup(self.db.close)

    def query(self, sql, params):
        return [dict(row) for row in self.db.execute(sql.replace('%s', '?'), params)]

    def test_newer_unrelated_logs_do_not_hide_latest_three_connections(self):
        rows = _mysql_robot_connect_logs('target', '', '', '')
        self.assertEqual([row['id'] for row in rows], [4, 3, 2])

    def test_keyword_ip_and_time_filters_still_apply(self):
        rows = _mysql_robot_connect_logs('target', 'Xiaomi', '2026-09-17 00:00:00', '2026-09-17 00:01:00')
        self.assertEqual([row['id'] for row in rows], [3])
        rows = _mysql_robot_connect_logs('target', '3.3.3.3', '', '')
        self.assertEqual([row['id'] for row in rows], [4])

    def test_no_matching_connection_is_empty(self):
        self.assertEqual(_mysql_robot_connect_logs('missing', '', '', ''), [])
        self.assertEqual(_mysql_robot_connect_logs('target', '暂停', '', ''), [])


if __name__ == '__main__':
    unittest.main()
