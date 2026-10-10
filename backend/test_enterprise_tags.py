import sqlite3
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from enterprise_tags import EnterpriseTagStore
import main


class Cursor:
    def __init__(self, conn):
        self.cursor = conn.cursor()
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.cursor.close()
    def execute(self, sql, args=()):
        self.cursor.execute(sql.replace('%s', '?').replace(' FOR UPDATE', '').replace('INSERT IGNORE', 'INSERT OR IGNORE'), args)
    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row else None
    def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]
    @property
    def lastrowid(self):
        return self.cursor.lastrowid


class Connection:
    def __init__(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('PRAGMA foreign_keys=ON')
        self.conn.execute('CREATE TABLE enterprise_authorization_tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE)')
        self.conn.execute('CREATE TABLE enterprise_authorization_tag_links(corp_id TEXT, tag_id INTEGER REFERENCES enterprise_authorization_tags(id) ON DELETE CASCADE, PRIMARY KEY(corp_id,tag_id))')
    def cursor(self):
        return Cursor(self.conn)
    def commit(self):
        self.conn.commit()
    def rollback(self):
        self.conn.rollback()
    def close(self):
        pass


class TagStoreTests(unittest.TestCase):
    def setUp(self):
        self.connection = Connection()
        self.store = EnterpriseTagStore(lambda: self.connection)
        self.first = self.store.save('某集团')['id']
        self.second = self.store.save('重点客户')['id']
    def tearDown(self):
        self.connection.conn.close()

    def test_bulk_add_is_repeat_safe_and_preserves_existing_tags(self):
        self.store.apply(['a'], [self.second], 'add')
        self.store.apply(['a', 'b'], [self.first], 'add')
        self.store.apply(['a', 'b'], [self.first], 'add')
        tags = self.store.assignments(['a', 'b', 'c'])
        self.assertEqual({t['id'] for t in tags['a']}, {self.first, self.second})
        self.assertEqual(len(tags['b']), 1)
        self.assertNotIn('c', tags)

    def test_remove_only_selected_tag_and_replace_can_clear(self):
        self.store.apply(['a', 'b'], [self.first, self.second], 'add')
        self.store.apply(['a'], [self.first], 'remove')
        self.assertEqual([t['id'] for t in self.store.assignments(['a'])['a']], [self.second])
        self.store.apply(['a'], [], 'replace')
        self.assertEqual(self.store.assignments(['a']), {})
        self.assertEqual(len(self.store.assignments(['b'])['b']), 2)

    def test_rename_preserves_assignments_and_delete_removes_links_only(self):
        self.store.apply(['a', 'b'], [self.first, self.second], 'add')
        self.store.save('新集团名称', self.first)
        self.assertIn('新集团名称', [t['name'] for t in self.store.assignments(['a'])['a']])
        self.store.delete(self.first)
        for tags in self.store.assignments(['a', 'b']).values():
            self.assertEqual([t['id'] for t in tags], [self.second])

    def test_missing_tag_rolls_back_without_removing_previous_assignments(self):
        self.store.apply(['a'], [self.first], 'add')
        with self.assertRaises(HTTPException):
            self.store.apply(['a'], [999], 'replace')
        self.assertEqual(self.store.assignments(['a'])['a'][0]['id'], self.first)


class TagApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_filters_compose_with_existing_deployment_filter(self):
        rows = [{'corpId': 'a'}, {'corpId': 'b'}, {'corpId': 'c'}]
        with patch.object(main, '_require_admin'), patch.object(main, '_require_feature_enabled'), patch.object(main, '_require_configured_path', return_value='/list'), patch.object(main, 'fetch_worktool_api', new=AsyncMock(return_value={'data': rows})), patch.object(main, '_get_enterprise_authorization_metadata', return_value={'a': 'saas', 'b': 'private', 'c': 'saas'}), patch.object(main, '_get_enterprise_authorization_created_at', return_value={}), patch.object(main, 'EnterpriseTagStore') as store:
            store.return_value.assignments.return_value = {'a': [{'id': 1, 'name': '集团'}], 'b': [{'id': 1, 'name': '集团'}]}
            all_rows = await main.admin_wework_authorization_list(user={'id': 1})
            self.assertEqual(len(all_rows['data']), 3)
            untagged = await main.admin_wework_authorization_list(tag_filter='untagged', user={'id': 1})
            self.assertEqual([r['corpId'] for r in untagged['data']], ['c'])
            filtered = await main.admin_wework_authorization_list(tag_filter='1', deployment_type='saas', user={'id': 1})
            self.assertEqual([r['corpId'] for r in filtered['data']], ['a'])

    async def test_rejects_missing_enterprise_before_changing_tags(self):
        with patch.object(main, '_require_enterprise_tag_admin'), patch.object(main, '_require_configured_path', return_value='/list'), patch.object(main, 'fetch_worktool_api', new=AsyncMock(return_value={'data': []})), patch.object(main, 'EnterpriseTagStore') as store:
            with self.assertRaises(HTTPException):
                await main.apply_enterprise_tags(main.EnterpriseTagAssignment(corp_ids=['missing'], tag_ids=[1], operation='add'), MagicMock(), {'id': 1})
            store.assert_not_called()

    async def test_non_admin_cannot_use_tag_routes(self):
        with patch.object(main, '_require_admin', side_effect=HTTPException(403, 'denied')), patch.object(main, 'EnterpriseTagStore') as store:
            with self.assertRaises(HTTPException):
                main.create_enterprise_tag(main.EnterpriseTagName(name='集团'), {'id': 2})
            store.assert_not_called()
