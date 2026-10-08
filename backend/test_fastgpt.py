import unittest
import main


class FastGPTRequestTest(unittest.TestCase):
    def test_supported_addresses(self):
        for origin in ('http://192.0.2.1:3004', 'https://fastgpt.example.com'):
            for suffix in ('', '/', '/api', '/api/', '/api/v1', '/api/v1/', '/api/v1/chat/completions', '/api/v1/chat/completions/'):
                with self.subTest(origin=origin, suffix=suffix):
                    request = main._build_provider_http_request({'provider_type': 'fastgpt', 'base_url': origin + suffix, 'api_token': 'app-key'}, '你好')
                    self.assertEqual(request['url'], origin + '/api/v1/chat/completions')
                    self.assertEqual(request['headers']['Authorization'], 'Bearer app-key')
                    self.assertEqual(request['payload'], {'messages': [{'role': 'user', 'content': '你好'}], 'stream': False})

    def test_proxy_prefix_and_query(self):
        self.assertEqual(main._normalize_fastgpt_url(' https://example.com/fastgpt/api/?x=1 '), 'https://example.com/fastgpt/api/v1/chat/completions?x=1')

    def test_openai_unchanged(self):
        request = main._build_provider_http_request({'provider_type': 'openai', 'base_url': 'https://example.com/custom'}, 'hi')
        self.assertEqual(request['url'], 'https://example.com/custom')
        self.assertNotIn('stream', request['payload'])

    def test_application_options(self):
        request = main._build_provider_http_request({'provider_type': 'fastgpt', 'base_url': 'https://example.com', 'extra_json': '{"request_body":{"chatId":"session-1","detail":true}}'}, 'hi', {'variables': {'name': 'Alice'}})
        self.assertEqual(request['payload']['chatId'], 'session-1')
        self.assertEqual(request['payload']['variables'], {'name': 'Alice'})
        self.assertFalse(request['payload']['stream'])
