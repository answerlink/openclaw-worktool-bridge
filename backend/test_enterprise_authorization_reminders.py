import unittest
from contextlib import ExitStack
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

import main


class EnterpriseAuthorizationReminderTests(unittest.IsolatedAsyncioTestCase):
    async def test_sends_only_fifteen_and_five_day_reminders(self):
        rows = {
            'code': 200,
            'data': [
                {'corpId': 'corp-15', 'corpName': '十五天企业', 'expireTime': '2026-10-16T23:59:59'},
                {'corpId': 'corp-5', 'corpName': '五天企业', 'expireTime': '2026-10-06T23:59:59'},
                {'corpId': 'corp-1', 'corpName': '一天企业', 'expireTime': '2026-10-02T23:59:59'},
            ],
        }
        now = datetime(2026, 10, 1, 10, 30, tzinfo=timezone(timedelta(hours=8)))
        with ExitStack() as stack:
            stack.enter_context(patch.object(main, 'ENABLE_ADMIN_ENTERPRISE_AUTH', True))
            stack.enter_context(patch.object(main, 'WORKTOOL_WEWORK_AUTH_LIST_PATH', '/authorization/list'))
            stack.enter_context(patch.object(main, 'wecom_webhook_url', return_value='https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test'))
            stack.enter_context(patch.object(main, 'fetch_worktool_api', new_callable=AsyncMock, return_value=rows))
            reserve = stack.enter_context(patch.object(main, '_reserve_enterprise_authorization_expiry_reminder', return_value=True))
            finish = stack.enter_context(patch.object(main, '_finish_enterprise_authorization_expiry_reminder'))
            send = stack.enter_context(patch.object(main, 'send_wecom_text', new_callable=AsyncMock))
            result = await main.run_enterprise_authorization_expiry_reminders_tick(now)

        self.assertEqual(result, {'skipped': False, 'sent': 2, 'failed': 0})
        self.assertEqual(send.await_count, 2)
        self.assertIn('剩余：15 天', send.await_args_list[0].args[0])
        self.assertIn('剩余：5 天', send.await_args_list[1].args[0])
        self.assertEqual(reserve.call_count, 2)
        self.assertEqual(finish.call_count, 2)

    async def test_skips_outside_the_daily_schedule(self):
        now = datetime(2026, 10, 1, 10, 29, tzinfo=timezone(timedelta(hours=8)))
        result = await main.run_enterprise_authorization_expiry_reminders_tick(now)
        self.assertEqual(result, {'skipped': True, 'reason': 'outside_schedule'})


if __name__ == '__main__':
    unittest.main()
