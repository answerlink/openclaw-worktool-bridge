import base64
import os
import unittest
from unittest.mock import AsyncMock, patch, MagicMock

from fastapi import HTTPException
from pydantic import ValidationError
from feedback import FeedbackPayload, image_message, post_message, submit_feedback

URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test'
PNG = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\nexample').decode()


class FeedbackTests(unittest.IsolatedAsyncioTestCase):
    def payload(self, **kwargs):
        return FeedbackPayload(kind='problem', description='页面保存失败', page='/robots', **kwargs)

    async def test_unconfigured_and_invalid_configuration(self):
        for url in ('', 'https://example.com/send?key=test'):
            with patch.dict(os.environ, FEEDBACK_WECOM_WEBHOOK_URL=url):
                with self.assertRaises(HTTPException) as ctx:
                    await submit_feedback(self.payload(), {'id': 1})
                self.assertEqual(ctx.exception.status_code, 503)

    async def test_images_and_account_are_sent_and_long_text_fits_wecom(self):
        body = self.payload(images=[PNG], robot_id='selected-robot-123')
        body.description = '反馈内容很长' * 250
        with patch.dict(os.environ, FEEDBACK_WECOM_WEBHOOK_URL=URL), patch('feedback.post_message', new_callable=AsyncMock) as send:
            result = await submit_feedback(body, {'id': 17, 'phone': 'test-account'})
        messages = [call.args[2] for call in send.await_args_list]
        self.assertEqual(messages[-1], image_message(PNG))
        self.assertIn('test-account', messages[0]['text']['content'])
        self.assertIn('机器人 ID：selected-robot-123\n', messages[0]['text']['content'])
        self.assertIn(result['feedback_id'], messages[0]['text']['content'])
        for payload in messages[:-1]:
            self.assertLessEqual(len(payload['text']['content'].encode()), 2048)

    async def test_no_selected_robot_leaves_id_empty(self):
        for body in (self.payload(), self.payload(robot_id='')):
            with patch.dict(os.environ, FEEDBACK_WECOM_WEBHOOK_URL=URL), patch('feedback.post_message', new_callable=AsyncMock) as send:
                await submit_feedback(body, {'id': 1})
                self.assertIn('机器人 ID：\n', send.await_args.args[2]['text']['content'])

    async def test_partial_failure_is_reported_without_leaking_webhook(self):
        with patch.dict(os.environ, FEEDBACK_WECOM_WEBHOOK_URL=URL), patch('feedback.post_message', new_callable=AsyncMock, side_effect=[None, ValueError(URL)]):
            with self.assertRaises(HTTPException) as ctx:
                await submit_feedback(self.payload(images=[PNG]), {'id': 1})
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertIn('部分发送', ctx.exception.detail)
        self.assertNotIn(URL, ctx.exception.detail)

    async def test_invalid_images_are_rejected_before_any_send(self):
        for value in ('data:image/png;base64,invalid', 'data:image/png;base64,YWJj', 'data:image/svg+xml;base64,YWJj', 'x' * 2800001):
            with patch.dict(os.environ, FEEDBACK_WECOM_WEBHOOK_URL=URL), patch('feedback.post_message', new_callable=AsyncMock) as send:
                with self.assertRaises(HTTPException):
                    await submit_feedback(self.payload(images=[value]), {'id': 1})
                send.assert_not_awaited()

    async def test_whitespace_is_rejected(self):
        body = self.payload()
        body.description = '   '
        with patch.dict(os.environ, FEEDBACK_WECOM_WEBHOOK_URL=URL):
            with self.assertRaises(HTTPException):
                await submit_feedback(body, {'id': 1})

    def test_attachment_and_description_limits(self):
        with self.assertRaises(ValidationError):
            self.payload(images=[PNG] * 4)
        with self.assertRaises(ValidationError):
            FeedbackPayload(kind='problem', description='x' * 1501, page='/')

    async def test_wecom_application_error_is_failure(self):
        response = MagicMock(status=200)
        response.json = AsyncMock(return_value={'errcode': 45009})
        session = MagicMock()
        session.post.return_value.__aenter__ = AsyncMock(return_value=response)
        session.post.return_value.__aexit__ = AsyncMock(return_value=False)
        with self.assertRaises(ValueError):
            await post_message(session, URL, {})


class FeedbackEndpointTests(unittest.TestCase):
    def test_authentication_is_required(self):
        import main
        from fastapi.testclient import TestClient
        response = TestClient(main.app).post('/api/v1/feedback', json={
            'kind': 'problem', 'description': 'test', 'page': '/robots',
        })
        self.assertEqual(response.status_code, 401)

    def test_authenticated_account_is_used(self):
        import main
        from fastapi.testclient import TestClient
        user = {'id': 17, 'phone': 'account-from-auth'}
        main.app.dependency_overrides[main.get_current_user] = lambda: user
        try:
            with patch.object(main, 'submit_feedback', new_callable=AsyncMock, return_value={'ok': True}) as submit:
                response = TestClient(main.app).post('/api/v1/feedback', json={
                    'kind': 'suggestion', 'description': 'test', 'page': '/robots', 'phone': 'forged',
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(submit.await_args.args[1], user)
        finally:
            main.app.dependency_overrides.pop(main.get_current_user, None)


if __name__ == '__main__':
    unittest.main()
