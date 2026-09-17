import sqlite3
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from enterprise_shares import EnterpriseShareStore


class SqliteCursor:
    """Exercise store SQL with SQLite, translating only MySQL UPSERT syntax."""
    def __init__(self, db):
        self.db = db
        self.cursor = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        if self.cursor:
            self.cursor.close()

    def execute(self, sql, params=()):
        sql = sql.replace('%s', '?')
        sql = sql.replace('ON DUPLICATE KEY UPDATE token=VALUES(token)', 'ON CONFLICT(corp_id) DO UPDATE SET token=excluded.token')
        sql = sql.replace('ON DUPLICATE KEY UPDATE corp_id=VALUES(corp_id)', 'ON CONFLICT(corp_id) DO NOTHING')
        self.cursor = self.db.execute(sql, params)

    def fetchone(self):
        row = self.cursor.fetchone()
        return dict(row) if row else None


class SqliteConnection:
    def __init__(self, db):
        self.db = db

    def cursor(self):
        return SqliteCursor(self.db)

    def commit(self):
        self.db.commit()

    def close(self):
        pass


class EnterpriseShareTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('CREATE TABLE enterprise_authorization_shares(corp_id TEXT PRIMARY KEY, token TEXT UNIQUE COLLATE BINARY)')
        self.db.execute('CREATE TABLE enterprise_authorization_metadata(corp_id TEXT PRIMARY KEY)')
        self.addCleanup(self.db.close)
        self.rows = [
            {'corpId': 'corp-a', 'corpName': 'Company A', 'agentId': '10001', 'isEnabled': True, 'expireTime': '2027-09-01T23:59:59', 'remark': 'PRIVATE REMARK', 'secret': 'UPSTREAM SECRET'},
            {'corpId': 'corp-b', 'corpName': 'Company B', 'remark': 'OTHER PRIVATE REMARK'},
        ]
        self.user = {'id': 1, 'phone': 'share_admin'}
        patches = [
            patch.object(main, 'db_conn', side_effect=lambda: SqliteConnection(self.db)),
            patch.object(main, 'ENABLE_ADMIN_ENTERPRISE_AUTH', True),
            patch.object(main, 'ADMIN_PHONE_WHITELIST', {'share_admin'}),
            patch.object(main, 'WORKTOOL_WEWORK_AUTH_LIST_PATH', '/authorization/list'),
            patch.object(main, 'WORKTOOL_WEWORK_AUTH_DELETE_PATH', '/authorization/delete'),
            patch.object(main, 'fetch_worktool_api', new=AsyncMock(side_effect=lambda *args: {'code': 200, 'data': list(self.rows)})),
            patch.object(main, '_get_enterprise_authorization_metadata', return_value={'corp-a': 'saas'}),
            patch.object(main, '_begin_admin_audit', return_value=1),
            patch.object(main, '_finish_admin_audit'),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        main.app.dependency_overrides[main.get_current_user] = lambda: self.user
        self.addCleanup(main.app.dependency_overrides.pop, main.get_current_user, None)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.store = EnterpriseShareStore(main.db_conn)

    def create(self, corp_id='corp-a', regenerate=False):
        response = self.client.post('/api/v1/admin/wework/authorization/share', json={'corp_id': corp_id, 'regenerate': regenerate})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        return response.json()['path'].rsplit('/', 1)[1]

    def public(self, token, query=''):
        return self.client.get('/api/v1/public/enterprise-authorization/' + token + query)

    def test_public_access_is_anonymous_scoped_and_allowlisted(self):
        token = self.create()
        main.app.dependency_overrides.pop(main.get_current_user)
        response = self.public(token, '?corp_id=corp-b')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'corpId': 'corp-a', 'corpName': 'Company A', 'agentId': '10001',
            'isEnabled': True, 'expireTime': '2027-09-01T23:59:59', 'deploymentType': 'saas',
        })
        self.assertNotIn('PRIVATE', response.text)
        self.assertNotIn('secret', response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertIn('noindex', response.headers['x-robots-tag'])
        self.assertEqual(response.headers['referrer-policy'], 'no-referrer')
        # The public endpoint exposes no write operation.
        self.assertEqual(self.client.post('/api/v1/public/enterprise-authorization/' + token, json={}).status_code, 405)

    def test_lifecycle_rotation_revocation_and_reopening(self):
        token = self.create()
        self.assertRegex(token, r'^[A-Za-z0-9_-]{43}$')
        self.assertEqual(self.create(), token)
        self.assertTrue(self.client.get('/api/v1/admin/wework/authorization/share?corp_id=corp-a').json()['enabled'])
        rotated = self.create(regenerate=True)
        self.assertNotEqual(token, rotated)
        self.assertEqual(self.public(token).status_code, 404)
        self.assertEqual(self.public(rotated).status_code, 200)
        response = self.client.delete('/api/v1/admin/wework/authorization/share?corp_id=corp-a')
        self.assertEqual(response.json(), {'enabled': False, 'path': ''})
        self.assertEqual(self.public(rotated).status_code, 404)
        reopened = self.create()
        self.assertNotEqual(reopened, rotated)
        self.assertEqual(self.public(rotated).status_code, 404)

    def test_current_values_are_loaded_on_each_view(self):
        token = self.create()
        self.rows[0].update(corpName='Updated Company', isEnabled=False)
        self.assertEqual(self.public(token).json()['corpName'], 'Updated Company')
        self.assertFalse(self.public(token).json()['isEnabled'])

    def test_missing_and_malformed_links_never_fetch_upstream(self):
        for token in ('unknown', 'x' * 43, '123'):
            with patch.object(main, 'fetch_worktool_api', new=AsyncMock()) as fetch:
                self.assertEqual(self.public(token).status_code, 404)
                fetch.assert_not_awaited()

    def test_token_case_is_significant(self):
        token = self.create()
        self.assertNotEqual(token.swapcase(), token)
        self.assertEqual(self.public(token.swapcase()).status_code, 404)

    def test_management_requires_admin_and_authentication(self):
        for user, expected in [({'id': 2, 'phone': 'ordinary_user'}, 403), (None, 401)]:
            if user:
                self.user = user
            else:
                main.app.dependency_overrides.pop(main.get_current_user)
            self.assertEqual(self.client.get('/api/v1/admin/wework/authorization/share?corp_id=corp-a').status_code, expected)
            self.assertEqual(self.client.post('/api/v1/admin/wework/authorization/share', json={'corp_id': 'corp-a'}).status_code, expected)
            self.assertEqual(self.client.delete('/api/v1/admin/wework/authorization/share?corp_id=corp-a').status_code, expected)

    def test_missing_record_cannot_be_shared_and_external_deletion_hides_data(self):
        self.assertEqual(self.client.post('/api/v1/admin/wework/authorization/share', json={'corp_id': 'missing'}).status_code, 404)
        token = self.create()
        self.rows.pop(0)
        self.assertEqual(self.public(token).status_code, 404)

    def test_deleting_authorization_revokes_link_even_if_corp_is_recreated(self):
        token = self.create()
        with patch.object(main, 'post_worktool_api', new=AsyncMock(return_value={'code': 200})):
            response = self.client.post('/api/v1/admin/wework/authorization/delete?corp_id=corp-a')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.store.get('corp-a'))
        self.assertEqual(self.public(token).status_code, 404)

    def test_revoke_during_upstream_fetch_takes_effect(self):
        token = self.create()
        async def revoke(*args):
            self.store.revoke('corp-a')
            return {'code': 200, 'data': self.rows}
        with patch.object(main, 'fetch_worktool_api', new=AsyncMock(side_effect=revoke)):
            self.assertEqual(self.public(token).status_code, 404)

    def test_upstream_failure_is_not_reported_as_empty_or_leaked(self):
        token = self.create()
        for upstream in (HTTPException(502, 'PRIVATE REMARK'), {'code': 500, 'message': 'PRIVATE REMARK', 'data': self.rows}):
            mock = AsyncMock(side_effect=upstream) if isinstance(upstream, Exception) else AsyncMock(return_value=upstream)
            with patch.object(main, 'fetch_worktool_api', new=mock):
                response = self.public(token)
                self.assertEqual(response.status_code, 502)
                self.assertNotIn('PRIVATE', response.text)

    def test_feature_disabled_revokes_public_access(self):
        token = self.create()
        with patch.object(main, 'ENABLE_ADMIN_ENTERPRISE_AUTH', False):
            self.assertEqual(self.public(token).status_code, 404)
            self.assertEqual(self.client.post('/api/v1/admin/wework/authorization/share', json={'corp_id': 'corp-a'}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
