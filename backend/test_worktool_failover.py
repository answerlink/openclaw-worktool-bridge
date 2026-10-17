import asyncio
import json
import os
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch

import aiohttp
from aiohttp import web
from fastapi import HTTPException

import worktool_http as transport
from safe_outbound_http import read_limited_text


class FailoverTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        transport._states.clear()
        self.calls = []
        self.replies = []
        self.timeout = aiohttp.ClientTimeout(total=10)
        self.primary = 'http://primary.example'
        self.fallback = 'http://standby.example'
        self.client = transport.WorktoolSession(self.primary, self.fallback, self.timeout, 'saas', self.factory)

    @asynccontextmanager
    async def factory(self, timeout, deployment_mode):
        owner = self
        class Session:
            @asynccontextmanager
            async def request(self, method, url, **kwargs):
                owner.calls.append((method, url, timeout, kwargs, deployment_mode))
                reply = owner.replies.pop(0)
                if isinstance(reply, BaseException):
                    raise reply
                yield transport.BufferedResponse(*reply)
            def get(self, url, **kwargs): return self.request('GET', url, **kwargs)
            def post(self, url, **kwargs): return self.request('POST', url, **kwargs)
        yield Session()

    async def request(self, method='GET', **kwargs):
        async with self.client.request(method, self.primary+'/api', allow_redirects=False, **kwargs) as response:
            return response.status, await read_limited_text(response)

    async def test_healthy_primary_preserves_payload_and_timeout(self):
        self.replies = [(200, '{"code":200}')]
        await self.request('POST', params={'robotId':'r'}, json={'a':1}, headers={'X-Test':'secret'})
        _,url,timeout,kwargs,_=self.calls[0]
        self.assertEqual(url,self.primary+'/api')
        self.assertEqual(timeout.sock_connect,2)
        self.assertGreater(timeout.total,9)
        self.assertEqual(kwargs['json'],{'a':1})
        self.assertEqual(kwargs['headers'],{'X-Test':'secret'})

    async def test_read_network_failure_falls_back_and_cooldown_skips_primary(self):
        self.replies=[aiohttp.ServerDisconnectedError(),(200,'backup'),(200,'backup again')]
        self.assertEqual(await self.request(),(200,'backup'))
        self.assertEqual(await self.request(),(200,'backup again'))
        self.assertEqual([c[1] for c in self.calls],[self.primary+'/api',self.fallback+'/api',self.fallback+'/api'])

    async def test_write_before_connect_failure_can_retry(self):
        self.replies=[aiohttp.ConnectionTimeoutError(),(200,'ok')]
        self.assertEqual(await self.request('POST'),(200,'ok'))
        self.assertEqual(len(self.calls),2)

    async def test_write_connect_refused_can_retry(self):
        self.replies=[aiohttp.ClientConnectorError(None,OSError('refused')),(200,'ok')]
        self.assertEqual(await self.request('POST'),(200,'ok'))

    async def test_uncertain_writes_never_replayed(self):
        for error in (asyncio.TimeoutError(),aiohttp.ServerDisconnectedError(),aiohttp.ClientPayloadError()):
            transport._states.clear()
            self.client.states={n:transport.NodeState() for n in self.client.nodes}
            self.calls=[];self.replies=[error]
            with self.subTest(error=type(error).__name__),self.assertRaises(HTTPException) as ctx:
                await self.request('POST')
            self.assertIn('未自动重发',ctx.exception.detail)
            self.assertEqual(len(self.calls),1)

    async def test_write_gateway_error_marks_node_without_replay(self):
        self.replies=[(504,'gateway')]
        with self.assertRaises(HTTPException): await self.request('POST')
        self.assertEqual(len(self.calls),1)
        self.assertGreater(self.client.states[self.primary].failed_until,0)

    async def test_read_gateway_error_retries(self):
        for code in (502,503,504):
            self.client.states={n:transport.NodeState() for n in self.client.nodes}
            self.replies=[(code,'gateway'),(200,'ok')]
            self.assertEqual(await self.request(),(200,'ok'))

    async def test_business_errors_and_bad_json_are_not_retried(self):
        for status,body in [(400,'bad'),(401,'auth'),(403,'denied'),(404,'missing'),(500,'business'),(200,'{"code":500}'),(200,'not json')]:
            self.replies=[(status,body)];self.calls=[]
            self.assertEqual(await self.request(),(status,body))
            self.assertEqual(len(self.calls),1)
            self.assertEqual(self.client.states[self.primary].failed_until,0)

    async def test_both_down_fail_fast_during_cooldown(self):
        self.replies=[aiohttp.ConnectionTimeoutError(),aiohttp.ConnectionTimeoutError()]
        with self.assertRaises(asyncio.TimeoutError): await self.request()
        with self.assertRaises(HTTPException) as ctx: await self.request()
        self.assertEqual(ctx.exception.status_code,503)
        self.assertEqual(len(self.calls),2)

    async def test_recovery_uses_get_probe_even_for_writes(self):
        self.client.states[self.primary].failed_until=1
        self.replies=[(200,'{"code":200}'),(200,'ok')]
        await self.request('POST')
        self.assertEqual([(c[0],c[1]) for c in self.calls],[('GET',self.primary+'/test/version'),('POST',self.primary+'/api')])
        self.assertEqual(self.client.states[self.primary].failed_until,0)

    async def test_failed_probe_keeps_fallback(self):
        self.client.states[self.primary].failed_until=1
        self.replies=[(200,'{"code":500}'),(200,'ok')]
        await self.request()
        self.assertEqual(self.calls[-1][1],self.fallback+'/api')

    async def test_inflight_probe_is_not_duplicated(self):
        state=self.client.states[self.primary];state.failed_until=1;state.probing=True
        self.replies=[(200,'ok')]
        await self.request()
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.calls[0][1],self.fallback+'/api')

    async def test_cancellation_never_retries_or_marks_failure(self):
        self.replies=[asyncio.CancelledError()]
        with self.assertRaises(asyncio.CancelledError): await self.request()
        self.assertEqual(len(self.calls),1)
        self.assertEqual(self.client.states[self.primary].failed_until,0)

    async def test_caller_exception_cannot_replay(self):
        self.replies=[(200,'ok')]
        with self.assertRaises(aiohttp.ClientError):
            async with self.client.get(self.primary+'/api',allow_redirects=False):
                raise aiohttp.ClientError()
        self.assertEqual(len(self.calls),1)

    async def test_total_budget_not_reset_for_fallback(self):
        self.replies=[aiohttp.ConnectionTimeoutError(),(200,'ok')]
        with patch.object(transport.time,'monotonic',side_effect=[100,100,100,101,101,101]):
            await self.request()
        self.assertEqual(self.calls[0][2].total,10)
        self.assertEqual(self.calls[1][2].total,9)

    async def test_no_retry_after_budget_exhausted(self):
        self.replies=[asyncio.TimeoutError()]
        with patch.object(transport.time,'monotonic',side_effect=[100,100,111,111]):
            with self.assertRaises(asyncio.TimeoutError):await self.request()
        self.assertEqual(len(self.calls),1)

    async def test_fallback_empty_or_duplicate_preserves_single_node(self):
        for fallback in ('',self.primary+'/'):
            self.replies=[(200,'ok')]
            with patch.dict(os.environ,{'WORKTOOL_API_FALLBACK_BASE':fallback}):
                async with transport.worktool_session(self.timeout,primary=self.primary,deployment_mode='saas',session_factory=self.factory) as session:
                    async with session.get(self.primary+'/api',allow_redirects=False) as response:
                        self.assertEqual(response.status,200)
            self.assertIs(self.calls[-1][2],self.timeout)

    async def test_url_scope_and_config_validation(self):
        for url in ('http://primary.example.evil/api','http://other.example/api'):
            with self.assertRaises(ValueError):
                async with self.client.get(url,allow_redirects=False): pass
        for base in ('10.0.1.2:1234','http://user:pass@example.com','http://example.com?key=secret'):
            with self.assertRaises(ValueError):transport.normalize_base(base)
        self.assertEqual(self.calls,[])


class RealHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        transport._states.clear()
        self.runners=[]
        self.counts={'primary':0,'fallback':0}
    async def asyncTearDown(self):
        for runner in self.runners: await runner.cleanup()
    async def server(self,handler):
        app=web.Application();app.router.add_route('*','/{tail:.*}',handler)
        runner=web.AppRunner(app);await runner.setup()
        site=web.TCPSite(runner,'127.0.0.1',0);await site.start();self.runners.append(runner)
        return 'http://127.0.0.1:'+str(site._server.sockets[0].getsockname()[1])
    @asynccontextmanager
    async def factory(self,timeout,**kwargs):
        async with aiohttp.ClientSession(timeout=timeout) as session:yield session
    async def test_sent_write_disconnect_does_not_reach_backup(self):
        async def primary(req):
            await req.read();self.counts['primary']+=1
            req.transport.close()
            return web.Response(text='lost')
        async def fallback(req):
            self.counts['fallback']+=1;return web.Response(text='ok')
        p=await self.server(primary);f=await self.server(fallback)
        client=transport.WorktoolSession(p,f,aiohttp.ClientTimeout(total=2),'private',self.factory)
        with self.assertRaises(HTTPException):
            async with client.post(p+'/write',json={'send':1},allow_redirects=False):pass
        self.assertEqual(self.counts,{'primary':1,'fallback':0})
    async def test_slow_response_is_not_a_two_second_total_timeout(self):
        async def handler(req):
            await asyncio.sleep(2.1)
            return web.Response(text='slow success')
        p=await self.server(handler)
        client=transport.WorktoolSession(p,'http://127.0.0.1:1',aiohttp.ClientTimeout(total=4),'private',self.factory)
        async with client.get(p+'/read',allow_redirects=False) as response:
            self.assertEqual(await read_limited_text(response),'slow success')
    async def test_real_query_fails_over_with_same_parameters(self):
        async def primary(req):return web.Response(status=503)
        async def fallback(req):return web.json_response(dict(req.query))
        p=await self.server(primary);f=await self.server(fallback)
        client=transport.WorktoolSession(p,f,aiohttp.ClientTimeout(total=3),'private',self.factory)
        async with client.get(p+'/read',params={'robotId':'机器人'},allow_redirects=False) as response:
            self.assertEqual(json.loads(await read_limited_text(response)),{'robotId':'机器人'})

if __name__=='__main__':unittest.main()
