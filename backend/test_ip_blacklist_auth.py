import unittest
from unittest.mock import AsyncMock, MagicMock, call, patch

import main


class IpBlacklistAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_query_uses_renew_token_request(self):
        upstream = {"code": 200, "data": {"blackList": ["203.0.113.8"]}}
        with (
            patch.object(main, "_require_admin"),
            patch.object(main, "_require_feature_enabled"),
            patch.object(main, "WORKTOOL_IPACL_QUERY_PATH", "/robot/ipAcl/query"),
            patch.object(main, "fetch_worktool_renew_api", AsyncMock(return_value=upstream)) as request,
        ):
            result = await main.admin_ip_acl_blacklist_query({"id": 1})

        request.assert_awaited_once_with("/robot/ipAcl/query", {})
        self.assertEqual(result["blacklist"], ["203.0.113.8"])

    async def test_add_and_delete_use_renew_token_request(self):
        upstream = {"code": 200, "message": "操作成功"}
        request_obj = MagicMock()
        with (
            patch.object(main, "_require_admin"),
            patch.object(main, "_require_feature_enabled"),
            patch.object(main, "WORKTOOL_IPACL_ADD_PATH", "/robot/ipAcl/add"),
            patch.object(main, "WORKTOOL_IPACL_DELETE_PATH", "/robot/ipAcl/delete"),
            patch.object(main, "_begin_admin_audit", return_value=1),
            patch.object(main, "_finish_admin_audit"),
            patch.object(main, "post_worktool_renew_api", AsyncMock(return_value=upstream)) as request,
        ):
            await main.admin_ip_acl_blacklist_add("203.0.113.8", request_obj, {"id": 1})
            await main.admin_ip_acl_blacklist_delete("203.0.113.8", request_obj, {"id": 1})

        self.assertEqual(
            request.await_args_list,
            [
                call("/robot/ipAcl/add", {"ip": "203.0.113.8", "type": "blacklist"}),
                call("/robot/ipAcl/delete", {"ip": "203.0.113.8", "type": "blacklist"}),
            ],
        )


if __name__ == "__main__":
    unittest.main()
