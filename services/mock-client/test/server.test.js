import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordBuffer, delta } from '../src/buffer.js';
import { createCallbackStore } from '../src/receiver.js';
import { createControlServer } from '../src/server.js';
import { waitFor } from '../src/scenario.js';

async function setup(t, options = {}) {
  const app = await createControlServer({ port: 0, ...options });
  t.after(() => app.close());
  const call = async (path, body, headers = {}) => {
    const r = await fetch(app.url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  const create = async headers => (await call('/api/sessions', {}, headers)).body;
  return { app, call, create };
}

test('缓存按条数和UTF-8字节淘汰，大记录不撑破容量', () => {
  const cache = new RecordBuffer(3, 2048);
  for (let i = 1; i <= 100; i++) cache.push({ seq: i, text: '群'.repeat(200) });
  assert.ok(cache.bytes <= 2048); assert.ok(cache.items.length <= 3); assert.ok(cache.evicted > 0);
  assert.equal(cache.items.at(-1).seq, 100);
  cache.push({ seq: 101, text: 'x'.repeat(10000) });
  assert.equal(cache.items.at(-1).truncated, true);
  cache.clear(); assert.equal(cache.bytes, 0); assert.equal(cache.items.length, 0);
});

test('回调总容量受控，增量大报文使用预览且不重复下发', () => {
  const store = createCallbackStore();
  for (let i = 0; i < 20; i++) store.accept({ data: 'x'.repeat(800000) }, '/callback');
  assert.ok(store.buffer.bytes <= 8 * 1024 * 1024);
  const first = delta(store.records, 0, 20);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 300 * 1024);
  assert.equal(first.items[0].truncated, true);
  assert.equal(delta(store.records, first.cursor).items.length, 0);
  assert.equal(delta(store.records, 1).gap, true);
});

test('两会话同时连接，暂停、执行结果、回调及关闭互不影响', async t => {
  const { app, call, create } = await setup(t);
  const a = await create(), b = await create();
  const path = (s, op) => `/api/sessions/${s.id}/${op}`;
  for (const s of [a, b]) assert.equal((await call(path(s, 'connect'), { demo: true, config: { heartbeatMs: 600000 } })).status, 200);
  await waitFor(() => [...app.sessions.values()].every(s => !s.client.active));
  await call(path(a, 'action'), { action: 'pause' });
  await call(path(a, 'demo-command'), { command: { type: 203 }, messageId: 'a-waiting' });
  await call(path(b, 'demo-command'), { command: { type: 203 }, messageId: 'b-done' });
  const sa = app.sessions.get(a.id), sb = app.sessions.get(b.id);
  await waitFor(() => sb.receiver.records.some(x => x.body.messageId === 'b-done'));
  assert.equal(sa.client.queue.length, 1); assert.equal(sb.client.paused, false);
  assert.equal(sa.receiver.records.some(x => x.body.messageId === 'b-done'), false);
  assert.equal(sb.demo.pending.size, 0);
  assert.equal((await call(path(a, 'delete'), {})).status, 200);
  assert.equal((await call(path(a, 'state'))).status, 404);
  assert.equal(sb.client.snapshot().connected, true);
  assert.equal((await call(new URL(a.callbackUrl).pathname, { type: 102 })).status, 404);
});

test('增量游标、缓存淘汰提示、重连epoch与手动导出', async t => {
  const { app, call, create } = await setup(t);
  const s = await create(), base = `/api/sessions/${s.id}/`;
  await call(base + 'connect', { demo: true, config: { heartbeatMs: 600000 } });
  const instance = app.sessions.get(s.id);
  await waitFor(() => !instance.client.active);
  const first = (await call(base + 'state')).body;
  const query = new URLSearchParams({ epoch: first.epoch, after: first.traceCursor, callbackAfter: first.callbackCursor });
  const next = (await call(base + 'state?' + query)).body;
  assert.equal(next.trace.length, 0); assert.equal(next.callbacks.length, 0); assert.equal(next.reset, false);
  for (let i = 0; i < 2100; i++) instance.client.record('probe', { i });
  const gap = (await call(base + 'state?' + query)).body;
  assert.equal(gap.traceGap, true); assert.equal(gap.trace.length, 150);
  const exported = (await call(base + 'export')).body; assert.equal(exported.trace.length, 2000);
  await call(base + 'connect', { demo: true, config: { heartbeatMs: 600000 } });
  const reset = (await call(base + 'state?' + query)).body;
  assert.equal(reset.reset, true); assert.notEqual(reset.epoch, first.epoch); assert.ok(reset.trace.length);
});

test('并发创建遵守会话上限，闲置回收停止连接并释放接收器', async t => {
  const { app, call } = await setup(t, { maxSessions: 2, idleMs: 60000 });
  const creates = await Promise.all(Array.from({ length: 8 }, () => call('/api/sessions', {})));
  assert.equal(creates.filter(r => r.status === 200).length, 2); assert.equal(app.sessions.size, 2);
  const [a, b] = [...app.sessions.values()];
  await call(`/api/sessions/${a.id}/connect`, { demo: true });
  const client = a.client;
  b.scenarioRunning = true;
  await app.sweep(Date.now() + 120000);
  assert.equal(client.running, false); assert.equal(app.sessions.has(a.id), false);
  assert.equal(app.sessions.has(b.id), true);
  b.scenarioRunning = false;
  await app.sweep(Date.now() + 120000); assert.equal(app.sessions.size, 0);
});

test('连接失败不留下后台重连；停止运行中场景后可继续使用', async t => {
  const { app, call, create } = await setup(t);
  const s = await create(), base = `/api/sessions/${s.id}/`;
  assert.equal((await call(base + 'connect', { config: { url: 'bad-url' } })).status, 400);
  assert.equal(app.sessions.get(s.id).client.running, false);
  await call(base + 'connect', { demo: true });
  const running = call(base + 'scenario', { steps: [{ action: 'wait', ms: 60000 }] });
  await waitFor(() => app.sessions.get(s.id).scenarioRunning);
  assert.equal((await call(base + 'connect', { demo: true })).status, 409);
  await call(base + 'stop', {});
  assert.equal((await running).body.passed, false);
  assert.equal((await call(base + 'connect', { demo: true })).status, 200);
});

test('代理模式要求认证身份，隔离用户，回调地址支持子路径', async t => {
  await assert.rejects(createControlServer({ port: 0, publicUrl: 'https://test.example/mock/' }), /TRUST_PROXY_AUTH/);
  const { call, create } = await setup(t, { publicUrl: 'https://test.example/mock/', trustProxyAuth: true });
  assert.equal((await call('/api/sessions', {})).status, 401);
  const a = await create({ 'x-mock-user': 'tester-a' });
  assert.ok(a.callbackUrl.startsWith('https://test.example/mock/callbacks/'));
  const path = `/api/sessions/${a.id}/state`;
  assert.equal((await call(path, undefined, { 'x-mock-user': 'tester-b' })).status, 404);
  assert.equal((await call(path, undefined, { 'x-mock-user': 'tester-a' })).status, 200);
  assert.equal((await call('/api/sessions', {}, { 'x-mock-user': 'tester-a', origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/sessions', {}, { 'x-mock-user': 'tester-a', origin: 'https://test.example' })).status, 200);
  const cbPath = new URL(a.callbackUrl).pathname.replace('/mock', '');
  assert.equal((await call(cbPath, { type: 102 })).status, 200);
  const state = (await call(path, undefined, { 'x-mock-user': 'tester-a' })).body;
  assert.equal(state.callbacks[0].body.type, 102);
});

test('内部服务密钥不可省略或伪造，用户身份由受信代理传入', async t => {
  const { app, call } = await setup(t, { serviceKey: 'test-service-key-123456' });
  assert.equal((await call('/api/sessions', {})).status, 401);
  assert.equal((await call('/api/sessions', {}, { 'x-mock-service-key': 'wrong', 'x-mock-user': 'admin' })).status, 401);
  const headers = { 'x-mock-service-key': 'test-service-key-123456', 'x-mock-user': '1', 'x-mock-callback-base': 'https://console.test/api/v1/mock-client/' };
  const s = (await call('/api/sessions', {}, headers)).body;
  assert.ok(s.callbackUrl.startsWith('https://console.test/api/v1/mock-client/callbacks/'));
  assert.equal((await call('/api/sessions', undefined, headers)).body.sessions.length, 1);
  assert.equal((await call('/api/sessions', undefined, { ...headers, 'x-mock-user': '2' })).body.sessions.length, 0);
  assert.equal(app.sessions.size, 1);
  await assert.rejects(createControlServer({ port: 0, host: '0.0.0.0' }), /SERVICE_KEY/);
});

test('异步场景返回202，运行期间禁止覆盖，停止后可查询报告', async t => {
  const { app, call, create } = await setup(t);
  const s = await create(), base = `/api/sessions/${s.id}/`;
  await call(base + 'connect', { demo: true });
  const started = await call(base + 'scenario-start', { steps: [{ action: 'wait', ms: 60000 }] });
  assert.equal(started.status, 202); assert.ok(started.body.runId);
  assert.equal((await call(base + 'scenario-start', { steps: [] })).status, 409);
  assert.equal((await call(base + 'scenario-status')).body.run.status, 'running');
  await call(base + 'stop', {});
  await waitFor(() => !app.sessions.get(s.id).scenarioRunning);
  const final = (await call(base + 'scenario-status')).body.run;
  assert.equal(final.id, started.body.runId); assert.equal(final.status, 'failed'); assert.equal(final.report.passed, false);
});
