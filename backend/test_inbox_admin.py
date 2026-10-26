"""Regression tests: no real database access or notification delivery."""
import asyncio
import json
import unittest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
import main


class InboxAdminTests(unittest.TestCase):
    def setUp(self):
        self.conn = MagicMock()
        self.cur = self.conn.cursor.return_value.__enter__.return_value
        self.row = {'id': 2947, 'title': 'test', 'status': 'draft',
                    'recipient_scope_json': json.dumps({'type': 'phones', 'phones': ['15367811384']})}
        self.cur.fetchone.return_value = self.row
        for name in ('db_conn', '_require_admin', '_begin_admin_audit', '_finish_admin_audit', '_audit_failure'):
            p = patch.object(main, name)
            mock = p.start()
            self.addCleanup(p.stop)
            if name == 'db_conn':
                mock.return_value = self.conn

    def test_decode_supported_representations(self):
        for scope in ({'type': 'all'}, {'type': 'admins'}, {'type': 'phones', 'phones': ['15367811384']}):
            for raw in (scope, json.dumps(scope), json.dumps(scope).encode()):
                self.assertEqual(main._decode_recipient_scope(raw), scope)

    def test_invalid_scope_never_broadcasts(self):
        for raw in (None, '', '{}', 'null', '[]', '{bad', {'type': 'unknown'}, {'type': 'phones', 'phones': []}):
            with self.subTest(raw=raw):
                self.cur.reset_mock()
                self.cur.fetchone.return_value = dict(self.row, recipient_scope_json=raw)
                with patch.object(main, '_insert_inbox_deliveries') as insert:
                    with self.assertRaises(HTTPException):
                        main._publish_inbox_message(self.conn, 2947)
                    insert.assert_not_called()
                self.assertEqual(self.cur.execute.call_count, 1)

    def test_targeted_publish_queries_only_selected_phone(self):
        self.cur.fetchall.return_value = [{'id': 7}]
        with patch.object(main, '_insert_inbox_deliveries', return_value=1) as insert:
            result = main._publish_inbox_message(self.conn, 2947)
            insert.assert_called_once_with(self.cur, 2947, [7])
        self.assertEqual(result['recipient_count'], 1)
        sql, params = self.cur.execute.call_args_list[1].args
        self.assertIn('phone IN', sql)
        self.assertEqual(params, ('15367811384',))

    def test_list_decodes_scope_and_isolates_corrupt_row(self):
        self.cur.fetchone.return_value = {'c': 2}
        self.cur.fetchall.return_value = [self.row, dict(self.row, id=2948, recipient_scope_json='bad')]
        result = asyncio.run(main.admin_list_inbox_messages(1, 20, 'all', {'id': 1}))
        self.assertEqual(result['items'][0]['recipient_scope']['type'], 'phones')
        self.assertEqual(result['items'][1]['recipient_scope']['type'], 'invalid')

    def test_unchanged_update_succeeds(self):
        self.cur.rowcount = 0
        result = asyncio.run(main.admin_update_inbox_message(2947, main.InboxMessageUpdate(title='test'), None, {'id': 1}))
        self.assertTrue(result['ok'])
        self.conn.commit.assert_called_once()

    def test_missing_update_returns_404(self):
        self.cur.fetchone.return_value = None
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(main.admin_update_inbox_message(2947, main.InboxMessageUpdate(title='test'), None, {'id': 1}))
        self.assertEqual(ctx.exception.status_code, 404)
        self.conn.commit.assert_not_called()

    def test_concurrently_deleted_update_returns_404(self):
        self.cur.fetchone.side_effect = [self.row, None]
        with self.assertRaises(HTTPException):
            asyncio.run(main.admin_update_inbox_message(2947, main.InboxMessageUpdate(title='test'), None, {'id': 1}))
        self.conn.rollback.assert_called_once()

    def test_repeated_offline_succeeds(self):
        self.cur.rowcount = 0
        result = asyncio.run(main.admin_offline_inbox_message(2947, None, {'id': 1}))
        self.assertTrue(result['ok'])

    def test_missing_type_rejected(self):
        with self.assertRaises(HTTPException):
            main._normalize_recipient_scope({})


if __name__ == '__main__':
    unittest.main()
