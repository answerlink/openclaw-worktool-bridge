import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from pydantic import ValidationError

import main


class AdminRobotCreateTests(unittest.TestCase):
    def setUp(self):
        self.conn = MagicMock()
        self.cursor = self.conn.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = None
        self.patches = {}
        for name in ('worktool_db_conn', '_require_admin', '_begin_admin_audit',
                     '_finish_admin_audit', '_audit_failure', '_insert_robot_migrate_log'):
            p = patch.object(main, name)
            self.patches[name] = p.start()
            self.addCleanup(p.stop)
        self.patches['worktool_db_conn'].return_value = self.conn

    def create(self, robot_type=0):
        return main.admin_robot_create(main.RobotCreateRequest(robot_type=robot_type), None, {'id': 1})

    def test_types_ids_minimal_insert_and_logs(self):
        for robot_type, prefix in ((0, 'wt'), (1, 'wc')):
            with self.subTest(robot_type=robot_type):
                result = self.create(robot_type)
                self.assertRegex(result['robot_id'], '^' + prefix + '[a-z0-9]{30}$')
                self.cursor.execute.assert_called_with(
                    'INSERT INTO robot_info (robot_id, robot_type) VALUES (%s, %s)',
                    (result['robot_id'], robot_type),
                )
                self.assertEqual(self.patches['_insert_robot_migrate_log'].call_args.kwargs['new_robot_id'], result['robot_id'])
        self.assertEqual(self.conn.commit.call_count, 2)
        self.assertEqual(self.conn.close.call_count, 2)

    def test_non_admin_cannot_write(self):
        self.patches['_require_admin'].side_effect = HTTPException(403)
        with self.assertRaises(HTTPException):
            self.create()
        self.patches['worktool_db_conn'].assert_not_called()
        self.patches['_begin_admin_audit'].assert_not_called()

    def test_invalid_type_rejected(self):
        for value in (2, -1, 'wechat', None):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                main.RobotCreateRequest(robot_type=value)

    def test_collision_does_not_insert(self):
        self.cursor.fetchone.return_value = {'id': 123}
        with self.assertRaises(HTTPException) as ctx:
            self.create()
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.cursor.execute.call_count, 1)
        self.conn.commit.assert_not_called()
        self.conn.rollback.assert_called_once()

    def test_insert_failure_rolls_back_and_audits(self):
        self.cursor.execute.side_effect = [None, RuntimeError('insert failed')]
        with self.assertRaises(RuntimeError):
            self.create()
        self.conn.rollback.assert_called_once()
        self.conn.close.assert_called_once()
        self.conn.commit.assert_not_called()
        self.patches['_audit_failure'].assert_called_once()
        self.patches['_insert_robot_migrate_log'].assert_not_called()

    def test_log_failure_preserves_created_id(self):
        self.patches['_insert_robot_migrate_log'].side_effect = RuntimeError('log failed')
        with self.assertLogs(level='ERROR'):
            result = self.create()
        self.assertTrue(result['ok'])
        self.assertIn('warning', result)
        self.conn.commit.assert_called_once()
        self.conn.rollback.assert_not_called()


if __name__ == '__main__':
    unittest.main()
