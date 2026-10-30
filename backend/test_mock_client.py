import asyncio
import json
import os
from pathlib import Path
import subprocess
import unittest
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException
import httpx
from mock_client import Settings, install

KEY = 'test-only-mock-service-key-12345'


def app_for(settings, transport=None):
    app = FastAPI()

    def current(authorization=Header(None)):
        users = {'Bearer admin': {'id': 1, 'admin': True}, 'Bearer other': {'id': 2, 'admin': True}, 'Bearer member': {'id': 3, 'admin': False}}
        if authorization not in users:
            raise HTTPException(401, 'login required')
        return users[authorization]

    def admin(user):
        if not user['admin']:
            raise HTTPException(403, 'admin required')

    install(app, current, admin, settings, transport)
    return app


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests = []

        def upstream(request):
            self.requests.append(request)
            return httpx.Response(200, json={'ok': True})

        self.settings = Settings(True, 'http://mock-client:8787', KEY, 'https://console.test')
        self.app = app_for(self.settings, httpx.MockTransport(upstream))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test', headers={'Authorization': 'Bearer admin'})

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_disabled_and_non_admin_never_contact_engine(self):
        self.settings.enabled = False
        self.assertEqual((await self.client.get('/api/v1/admin/mock-client/sessions')).status_code, 404)
        self.settings.enabled = True
        self.assertEqual((await self.client.get('/api/v1/admin/mock-client/sessions', headers={'Authorization': 'Bearer member'})).status_code, 403)
        self.assertEqual((await self.client.get('/api/v1/admin/mock-client/sessions', headers={'Authorization': ''})).status_code, 401)
        self.assertFalse(self.requests)

    async def test_identity_and_key_are_server_supplied(self):
        r = await self.client.post('/api/v1/admin/mock-client/sessions', json={}, headers={'X-Mock-User': '999', 'X-Mock-Service-Key': 'evil'})
        self.assertEqual(r.status_code, 200)
        req = self.requests[0]
        self.assertEqual(req.headers['x-mock-user'], '1')
        self.assertEqual(req.headers['x-mock-service-key'], KEY)
        self.assertEqual(req.headers['x-mock-callback-base'], 'https://console.test/api/v1/mock-client/')
        self.assertNotIn('authorization', req.headers)

    async def test_paths_methods_and_query_are_restricted(self):
        sid = str(uuid4())
        base = '/api/v1/admin/mock-client/sessions/' + sid
        self.assertEqual((await self.client.post(base + '/scenario', json={})).status_code, 404)
        self.assertEqual((await self.client.get(base + '/connect')).status_code, 404)
        await self.client.get(base + '/state?after=12&callbackAfter=4&epoch=a&url=http://evil')
        self.assertEqual(str(self.requests[-1].url), 'http://mock-client:8787/api/sessions/' + sid + '/state?after=12&callbackAfter=4&epoch=a')

    async def test_callback_is_separate_and_works_without_login(self):
        token = str(uuid4())
        r = await self.client.post('/api/v1/mock-client/callbacks/' + token, json={'type': 102}, headers={'Authorization': ''})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.requests[-1].url.path, '/callbacks/' + token)
        self.assertNotIn('x-mock-user', self.requests[-1].headers)
        self.settings.enabled = False
        self.assertEqual((await self.client.post('/api/v1/mock-client/callbacks/' + token, json={})).status_code, 404)

    async def test_body_limit_and_invalid_json(self):
        path = '/api/v1/admin/mock-client/sessions'
        self.assertEqual((await self.client.post(path, content='[')).status_code, 400)
        self.assertEqual((await self.client.post(path, json=[])).status_code, 400)
        self.assertEqual((await self.client.post(path, json={'large': 'x' * (1024 * 1024)})).status_code, 413)
        self.assertFalse(self.requests)

    async def test_unavailable_service_returns_503(self):
        def failed(request):
            raise httpx.ConnectError('private endpoint details', request=request)
        app = app_for(self.settings, httpx.MockTransport(failed))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as c:
            r = await c.get('/api/v1/admin/mock-client/sessions', headers={'Authorization': 'Bearer admin'})
        self.assertEqual(r.status_code, 503)
        self.assertNotIn('private endpoint', r.text)


class LiveEngineTests(unittest.IsolatedAsyncioTestCase):
    """Real Node WS engine + real Python adapter; only Console login is a local fixture."""
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1] / 'services' / 'mock-client'
        cls.process = subprocess.Popen(['node', '--input-type=module', '-e',
            "import {createControlServer} from './src/server.js'; const app=await createControlServer({port:0,serviceKey:process.env.MOCK_CLIENT_SERVICE_KEY}); console.log(app.url); process.on('SIGTERM',async()=>{await app.close();process.exit(0)});"],
            cwd=root, env={**os.environ, 'MOCK_CLIENT_SERVICE_KEY': KEY}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        cls.url = cls.process.stdout.readline().strip()
        if not cls.url.startswith('http://127.0.0.1:'):
            cls.process.terminate()
            raise RuntimeError('Local mock engine failed to start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill(); cls.process.wait()
        cls.process.stdout.close(); cls.process.stderr.close()

    async def test_console_to_node_full_scenario_and_isolation(self):
        app = app_for(Settings(True, self.url, KEY, 'https://console.test'))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', headers={'Authorization': 'Bearer admin'}) as c:
            created = await c.post('/api/v1/admin/mock-client/sessions', json={})
            self.assertEqual(created.status_code, 200, created.text)
            sid = created.json()['id']; base = '/api/v1/admin/mock-client/sessions/' + sid
            self.assertTrue(created.json()['callbackUrl'].startswith('https://console.test/api/v1/mock-client/callbacks/'))
            try:
                self.assertEqual((await c.post(base + '/connect', json={'demo': True})).status_code, 200)
                started = await c.post(base + '/scenario-start', json={'steps': [
                    {'action': 'http', 'url': '${demoUrl}/send', 'body': {'command': {'type': 203, 'titleList': ['local-test']}}, 'saveAs': 'job'},
                    {'action': 'assert', 'match': {'kind': 'sent', 'packet.socketType': 3, 'packet.messageId': '${job.data.messageId}'}},
                    {'action': 'assert', 'source': 'callbacks', 'match': {'body.messageId': '${job.data.messageId}', 'body.errorCode': 0}},
                ]})
                self.assertEqual(started.status_code, 202, started.text)
                for _ in range(100):
                    run = (await c.get(base + '/scenario-status')).json()['run']
                    if run['status'] != 'running': break
                    await asyncio.sleep(.05)
                self.assertEqual(run['status'], 'passed', run)
                self.assertEqual(len(run['report']['checks']), 2)
                first = (await c.get(base + '/state')).json()
                second = (await c.get(base + '/state', params={'epoch': first['epoch'], 'after': first['traceCursor'], 'callbackAfter': first['callbackCursor']})).json()
                self.assertEqual(second['trace'], []); self.assertEqual(second['callbacks'], [])
                self.assertEqual((await c.get(base + '/state', headers={'Authorization': 'Bearer other'})).status_code, 404)
                self.assertEqual((await c.get('/api/v1/admin/mock-client/sessions', headers={'Authorization': 'Bearer other'})).json()['sessions'], [])
                callback_path = '/api/v1/mock-client/callbacks/' + first['callbackUrl'].rsplit('/', 1)[-1]
                self.assertEqual((await c.post(callback_path, json={'type': 102}, headers={'Authorization': ''})).status_code, 200)
            finally:
                await c.post(base + '/delete', json={})
            self.assertEqual((await c.post(callback_path, json={'type': 102})).status_code, 404)


if __name__ == '__main__':
    unittest.main()
