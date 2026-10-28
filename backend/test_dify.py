import unittest
from fastapi import HTTPException
import main

class DifyTests(unittest.TestCase):
    def request(self, extra=None, context=None, url='https://api.dify.ai/v1'):
        return main._build_provider_http_request({'provider_type':'dify','base_url':url,'api_token':'test-key','extra_json':extra},'你好',context)

    def test_urls(self):
        for suffix in ('','/','/v1','/v1/','/v1/chat-messages','/v1/chat-messages/'):
            self.assertEqual(self.request(url='https://example.org'+suffix)['url'],'https://example.org/v1/chat-messages')

    def test_payload_and_auth(self):
        r=self.request()
        self.assertEqual(r['headers']['Authorization'],'Bearer test-key')
        self.assertEqual(r['payload']['query'],'你好')
        self.assertEqual(r['payload']['response_mode'],'blocking')
        self.assertEqual(r['payload']['inputs'],{})
        self.assertNotIn('messages',r['payload'])
        self.assertNotIn('model',r['payload'])

    def test_inputs_and_no_shared_session(self):
        r=self.request({'request_body':{'inputs':{'name':'张三'},'conversation_id':'shared','response_mode':'streaming','user':'shared'}})
        self.assertEqual(r['payload']['inputs'],{'name':'张三'})
        self.assertEqual(r['payload']['conversation_id'],'')
        self.assertNotEqual(r['payload']['user'],'shared')
        self.assertEqual(r['payload']['response_mode'],'blocking')

    def test_context_and_identity(self):
        r=self.request(context={'messages':[{'role':'system','content':'提示'},{'role':'user','content':'问题'},{'role':'assistant','content':'回答'},{'role':'user','content':'追问'}],'_dify_user':'console-isolated'})
        self.assertIn('assistant: 回答',r['payload']['query'])
        self.assertIn('user: 追问',r['payload']['query'])
        self.assertEqual(r['payload']['user'],'console-isolated')

    def test_variables(self):
        self.assertIn('提问人',self.request(context={'variables':{'prompt_inject':'提问人'}})['payload']['query'])

    def test_invalid_inputs(self):
        with self.assertRaises(HTTPException): self.request({'request_body':{'inputs':[]}})

    def test_images_not_silently_dropped(self):
        with self.assertRaises(HTTPException): self.request(context={'messages':[{'role':'user','content':[{'type':'image_url'}]}]})

    def test_answer(self):
        self.assertEqual(main._extract_provider_text({'answer':' 好的 ','conversation_id':'x'}),'好的')

    def test_schema_accepts_dify(self):
        self.assertIn('dify', main.ProviderCreate.model_json_schema()['properties']['provider_type']['enum'])
