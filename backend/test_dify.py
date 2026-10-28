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
        self.assertNotIn('conversation_id',r['payload'])
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

    def test_images_collected(self):
        r=self.request(context={'messages':[{'role':'user','content':[{'type':'text','text':'看图'},{'type':'image_url','image_url':{'url':'https://example.org/a.png'}}]}]})
        self.assertEqual(r['payload']['_images'], ['https://example.org/a.png'])


    def test_answer(self):
        self.assertEqual(main._extract_provider_text({'answer':' 好的 ','conversation_id':'x'}),'好的')

    def test_schema_accepts_dify(self):
        self.assertIn('dify', main.ProviderCreate.model_json_schema()['properties']['provider_type']['enum'])

class DifyFilesTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload(self):
        from unittest.mock import MagicMock, AsyncMock
        from dify_provider import prepare_dify_files
        session=MagicMock()
        response=MagicMock(status=201)
        session.post.return_value.__aenter__=AsyncMock(return_value=response)
        payload={'user':'isolated','_images':['data:image/png;base64,aGVsbG8=']}
        await prepare_dify_files(session,'https://example.org/v1/chat-messages',{'Authorization':'Bearer test','Content-Type':'application/json'},payload,AsyncMock(return_value='{"id":"file-id"}'))
        self.assertEqual(payload['files'],[{'type':'image','transfer_method':'local_file','upload_file_id':'file-id'}])
        self.assertNotIn('_images',payload)
        args,kwargs=session.post.call_args
        self.assertEqual(args[0],'https://example.org/v1/files/upload')
        self.assertNotIn('Content-Type',kwargs['headers'])
        self.assertFalse(kwargs['allow_redirects'])

    async def test_remote(self):
        from dify_provider import prepare_dify_files
        payload={'_images':['https://example.org/image.png']}
        await prepare_dify_files(None,'',{},payload,None)
        self.assertEqual(payload['files'][0]['transfer_method'],'remote_url')

    async def test_invalid_base64(self):
        from dify_provider import prepare_dify_files
        with self.assertRaises(HTTPException):
            await prepare_dify_files(None,'',{}, {'_images':['data:image/png;base64,%%%']},None)

    async def test_upload_failure(self):
        from unittest.mock import MagicMock, AsyncMock
        from dify_provider import prepare_dify_files
        session=MagicMock()
        session.post.return_value.__aenter__=AsyncMock(return_value=MagicMock(status=403))
        with self.assertRaises(HTTPException) as error:
            await prepare_dify_files(session,'https://example.org/v1/chat-messages',{}, {'user':'u','_images':['data:image/png;base64,aGVsbG8=']},AsyncMock(return_value='disabled'))
        self.assertIn('403',error.exception.detail)
