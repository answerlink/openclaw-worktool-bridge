import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from fastapi import HTTPException
from command_failure_notify import Config, Service, failure_text, validate_webhook

URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test'


class PayloadTests(unittest.TestCase):
    def test_success_ignored(self):
        self.assertIsNone(failure_text('r', {'errorCode': 0, 'failList': []}))
        self.assertIsNone(failure_text('r', {'errorCode': '0'}))

    def test_missing_or_invalid_code_ignored(self):
        for body in ({}, {'errorCode': True}, {'errorCode': {}}, {'errorCode': 'bad'}):
            self.assertIsNone(failure_text('r', body))

    def test_failure(self):
        text = failure_text('r', {'errorCode': 201102, 'messageId': 'm', 'errorReason': '发送失败'})
        self.assertIn('发送失败', text)
        self.assertIn('消息 ID：m', text)

    def test_partial_failure_even_with_zero_code(self):
        self.assertIn('接收者2', failure_text('r', {'errorCode': 0, 'failList': ['接收者2']}))

    def test_bounded_content_no_raw_message(self):
        text = failure_text('r', {'errorCode': 1, 'errorReason': '错' * 5000,
                                 'failList': ['人' * 500] * 100, 'rawMsg': 'SECRET'})
        self.assertLessEqual(len(text.encode()), 2048)
        self.assertNotIn('SECRET', text)

    def test_webhook_allowlist(self):
        self.assertEqual(validate_webhook(' ' + URL + ' '), URL)
        self.assertEqual(validate_webhook(''), '')
        for value in ('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
                      'https://qyapi.weixin.qq.com.evil/cgi-bin/webhook/send?key=x',
                      'https://user:pass@qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
                      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=%20',
                      'https://127.0.0.1/cgi-bin/webhook/send?key=x'):
            with self.assertRaises(HTTPException):
                validate_webhook(value)


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.m = SimpleNamespace(bind_callback_by_type=AsyncMock(), delete_callback_by_type=AsyncMock(),
                                 get_callback_public_base_url=Mock(return_value='https://console.example'),
                                 safe_outbound_session=Mock())
        self.s = Service(self.m)
        self.s.read = Mock(return_value=None)
        self.s.write = Mock()
        self.s.bound = AsyncMock(return_value='')
        self.old = {'webhook_url': URL, 'callback_token': 'secret',
                    'callback_url': 'https://console.example/api/v1/callback/command-result/r?token=secret'}

    async def test_unconfigured_no_worktool_or_write(self):
        await self.s.save(Config(robot_id='r'))
        self.s.bound.assert_not_awaited()
        self.m.bind_callback_by_type.assert_not_awaited()
        self.s.write.assert_not_called()

    async def test_enable_platform_url_not_wecom(self):
        await self.s.save(Config(robot_id='r', webhook_url=URL))
        rid, callback, kind = self.m.bind_callback_by_type.await_args.args
        self.assertEqual((rid, kind), ('r', 1))
        self.assertIn('/callback/command-result/r?token=', callback)
        self.assertNotIn('weixin', callback)
        self.s.write.assert_called_once()

    async def test_replacement_requires_consent(self):
        self.s.bound.return_value = 'https://third.example/cb'
        with self.assertRaises(HTTPException) as e:
            await self.s.save(Config(robot_id='r', webhook_url=URL))
        self.assertEqual(e.exception.status_code, 409)
        self.s.write.assert_not_called()
        self.m.bind_callback_by_type.assert_not_awaited()
        await self.s.save(Config(robot_id='r', webhook_url=URL, replace_existing=True))
        self.m.bind_callback_by_type.assert_awaited_once()

    async def test_disable_owned_only(self):
        self.s.read.return_value = self.old
        self.s.bound.return_value = self.old['callback_url']
        await self.s.save(Config(robot_id='r'))
        self.m.delete_callback_by_type.assert_awaited_once_with('r', 1)
        self.assertEqual(self.s.write.call_args.args[1], '')

    async def test_disable_does_not_delete_custom_callback(self):
        self.s.read.return_value = self.old
        self.s.bound.return_value = 'https://third.example/cb'
        await self.s.save(Config(robot_id='r'))
        self.m.delete_callback_by_type.assert_not_awaited()

    async def test_edit_webhook_without_rebinding(self):
        self.s.read.return_value = self.old
        self.s.bound.return_value = self.old['callback_url']
        await self.s.save(Config(robot_id='r', webhook_url=URL + '2'))
        self.m.bind_callback_by_type.assert_not_awaited()
        self.assertEqual(self.s.write.call_args.args[1], URL + '2')

    async def test_bind_uncertain_keeps_reconcilable_config(self):
        self.m.bind_callback_by_type.side_effect = TimeoutError()
        with self.assertRaises(TimeoutError):
            await self.s.save(Config(robot_id='r', webhook_url=URL))
        self.s.write.assert_called_once()

    async def test_delete_failure_still_disables_local_delivery(self):
        self.s.read.return_value = self.old
        self.s.bound.return_value = self.old['callback_url']
        self.m.delete_callback_by_type.side_effect = TimeoutError()
        with self.assertRaises(TimeoutError):
            await self.s.save(Config(robot_id='r'))
        self.assertEqual(self.s.write.call_args.args[1], '')

    async def test_authentication(self):
        self.s.read.return_value = self.old
        with self.assertRaises(HTTPException) as e:
            await self.s.receive('r', 'bad', {'errorCode': 1})
        self.assertEqual(e.exception.status_code, 403)
        self.m.safe_outbound_session.assert_not_called()

    async def test_success_and_disabled_never_send(self):
        self.s.read.return_value = self.old
        await self.s.receive('r', 'secret', {'errorCode': 0})
        self.s.read.return_value = {**self.old, 'webhook_url': ''}
        await self.s.receive('r', 'secret', {'errorCode': 1})
        self.m.safe_outbound_session.assert_not_called()

    async def test_failure_delivery(self):
        from unittest.mock import patch
        session = AsyncMock()
        self.m.safe_outbound_session.return_value = session
        self.m.APP_DEPLOYMENT_MODE = 'saas'
        self.s.read.return_value = self.old
        with patch('command_failure_notify.post_message', new_callable=AsyncMock) as post:
            await self.s.receive('r', 'secret', {'errorCode': 201102})
            post.assert_awaited_once()
            self.assertEqual(post.await_args.args[1], URL)
            self.assertEqual(post.await_args.args[2]['msgtype'], 'text')


if __name__ == '__main__':
    unittest.main()

class RouteTests(unittest.TestCase):
    def test_config_requires_login(self):
        from fastapi.testclient import TestClient
        import main
        client = TestClient(main.app)
        self.assertEqual(client.get('/api/v1/robot-info/command-failure-notification?robot_id=r').status_code, 401)
        self.assertEqual(client.post('/api/v1/robot-info/command-failure-notification', json={'robot_id': 'r'}).status_code, 401)

    def test_callback_rejects_invalid_body_and_token(self):
        from fastapi.testclient import TestClient
        from unittest.mock import patch
        import main
        client = TestClient(main.app)
        self.assertEqual(client.post('/api/v1/callback/command-result/r', content='bad').status_code, 400)
        self.assertEqual(client.post('/api/v1/callback/command-result/r', json=[]).status_code, 400)
        self.assertEqual(client.post('/api/v1/callback/command-result/r', content='x' * 262145).status_code, 413)
        with patch.object(main.command_failure_service, 'read', return_value=None):
            self.assertEqual(client.post('/api/v1/callback/command-result/r', json={'errorCode': 1}).status_code, 403)
