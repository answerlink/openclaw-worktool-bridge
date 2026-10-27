import unittest
from unittest.mock import MagicMock, patch
import main

class AuditKeywordTests(unittest.IsolatedAsyncioTestCase):
    async def query(self, **kwargs):
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = {'c': 0}
        cur.fetchall.return_value = []
        with patch.object(main, 'db_conn', return_value=conn), patch.object(main, '_require_admin'):
            result = await main.admin_operation_logs(user={}, page=1, page_size=20, **kwargs)
        return cur.execute.call_args_list, result

    async def test_keyword_or_and_filter_pagination(self):
        calls, result = await self.query(keyword=' 中华 ', module='private_license', status='success')
        sql, params = calls[0].args
        self.assertIn("JSON_SEARCH(before_json", sql)
        self.assertIn("JSON_SEARCH(after_json", sql)
        self.assertIn('OR target_name', sql)
        self.assertIn('AND module=', sql)
        self.assertEqual(params, ('%中华%',)*6 + ('private_license','success'))
        self.assertEqual(calls[1].args[1], params + (20,0))
        self.assertEqual(result['total'],0)

    async def test_literal_wildcards_and_bound_sql(self):
        calls, _ = await self.query(keyword="a%_!' OR 1=1")
        sql, params = calls[0].args
        self.assertNotIn('OR 1=1',sql)
        self.assertEqual(params[0], "%a!%!_!!' OR 1=1%")

    async def test_empty_search_avoids_json_scan(self):
        calls,_ = await self.query(keyword='  ')
        self.assertNotIn('JSON_SEARCH',calls[0].args[0])

    async def test_old_filters_still_supported(self):
        calls,_ = await self.query(keyword=None,target_id='abc')
        self.assertEqual(calls[0].args[1],('%abc%',))

    def test_auth_required(self):
        from fastapi.testclient import TestClient
        self.assertEqual(TestClient(main.app).get('/api/v1/admin/audit-logs?keyword=x').status_code,401)
