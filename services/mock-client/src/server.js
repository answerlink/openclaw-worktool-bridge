import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MockClient } from './engine.js';
import { readJson, json, listen, createCallbackStore } from './receiver.js';
import { createDemoBackend } from './demo-backend.js';
import { runScenario, waitFor } from './scenario.js';
import { delta } from './buffer.js';

export async function createControlServer({ port = 8787, publicUrl = '', trustProxyAuth = false,
  maxSessions = 4, idleMs = 30 * 60 * 1000, host = '127.0.0.1', serviceKey = '' } = {}) {
  const external = publicUrl ? new URL(publicUrl.endsWith('/') ? publicUrl : publicUrl + '/') : null;
  if (external && (!['http:', 'https:'].includes(external.protocol) || external.search || external.hash || external.username || external.password)) throw new Error('PUBLIC_URL 需要 HTTP/HTTPS 页面根地址');
  if (external && !trustProxyAuth && !serviceKey) throw new Error('服务器部署需启用 TRUST_PROXY_AUTH=1，并由网关验证登录身份');
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 20) throw new Error('MAX_SESSIONS 需为 1～20');
  if (!Number.isFinite(idleMs) || idleMs < 0) throw new Error('SESSION_IDLE_MINUTES 不能为负');
  if (!['127.0.0.1', 'localhost'].includes(host) && !serviceKey) throw new Error('非本机监听必须配置 MOCK_CLIENT_SERVICE_KEY');
  const sessions = new Map();
  const html = await readFile(fileURLToPath(new URL('../public/index.html', import.meta.url)));
  let localUrl, closing = false;
  async function dispose(s) { s.client?.stop(); await s.demo?.close(); s.demo = null; }
  async function sweep(now = Date.now()) {
    for (const [id, s] of sessions) {
      if (idleMs && !s.busy && !s.scenarioRunning && now - s.lastAccess >= idleMs) {
        sessions.delete(id); await dispose(s);
      }
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (closing) return json(res, 503, { error: '服务正在停止' });
      const url = new URL(req.url, localUrl), path = url.pathname;
      const allowedHosts = new Set([new URL(localUrl).host, `localhost:${server.address().port}`, external?.host]);
      if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: '访问地址不匹配' });
      if (path === '/health' && req.method === 'GET') return json(res, 200, { status: 'healthy' });
      // Callback URLs are per-session capabilities, intentionally outside management login.
      if (path.startsWith('/callbacks/') && req.method === 'POST') {
        const s = [...sessions.values()].find(s => path === `/callbacks/${s.callbackToken}`);
        if (!s) return json(res, 404, { error: '回调会话已失效' });
        s.receiver.accept(await readJson(req), path);
        return json(res, 200, { code: 200, message: 'success' });
      }
      if (serviceKey) {
        const actual = Buffer.from(String(req.headers['x-mock-service-key'] || '')), expected = Buffer.from(serviceKey);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json(res, 401, { error: '模拟服务认证失败' });
      }
      const owner = external || serviceKey ? req.headers['x-mock-user'] : 'local';
      if (!owner || typeof owner !== 'string') return json(res, 401, { error: '请先登录管理后台' });
      if (req.method !== 'GET' && req.headers.origin && ![external?.origin, localUrl, `http://localhost:${server.address().port}`].includes(req.headers.origin)) return json(res, 403, { error: '跨站请求被拒绝' });
      if (req.method === 'GET' && path === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(html);
      }
      if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json')) return json(res, 415, { error: '需要 application/json' });
      if (path === '/api/sessions' && req.method === 'GET') {
        return json(res, 200, { sessions: [...sessions.values()].filter(s => s.owner === owner).map(s => ({
          id: s.id, robotId: s.client?.config.robotId || '', connected: Boolean(s.client?.snapshot().connected),
          running: Boolean(s.client?.running), scenarioRunning: s.scenarioRunning, lastAccess: s.lastAccess
        })), maxSessions, idleMinutes: idleMs / 60000 });
      }
      if (path === '/api/sessions' && req.method === 'POST') {
        await sweep();
        if (sessions.size >= maxSessions) return json(res, 409, { error: `最多 ${maxSessions} 个会话，请先关闭不用的会话` });
        const id = randomUUID(), callbackToken = randomUUID();
        const s = { id, owner, callbackToken, lastAccess: Date.now(), receiver: createCallbackStore(), epoch: randomUUID(), busy: false, scenarioRunning: false };
        const callbackBase = serviceKey && req.headers['x-mock-callback-base'] ? new URL(req.headers['x-mock-callback-base']) : external || localUrl + '/';
        s.callbackUrl = new URL(`callbacks/${callbackToken}`, callbackBase).toString();
        s.localCallbackUrl = `${localUrl}/callbacks/${callbackToken}`;
        sessions.set(id, s); return json(res, 200, { id, callbackUrl: s.callbackUrl, idleMinutes: idleMs / 60000 });
      }
      const match = path.match(/^\/api\/sessions\/([^/]+)\/(state|export|connect|stop|delete|action|rules|demo-command|scenario|scenario-start|scenario-status)$/);
      if (!match) return json(res, 404, { error: 'Not found' });
      const s = sessions.get(match[1]), operation = match[2];
      if (!s || s.owner !== owner) return json(res, 404, { error: '会话已清理，请新建会话' });
      s.lastAccess = Date.now();
      if (req.method === 'GET' && operation === 'scenario-status') return json(res, 200, { run: s.scenarioRun || null });
      if (req.method === 'GET' && ['state', 'export'].includes(operation)) {
        const snapshot = s.client?.snapshot() || {}, reset = url.searchParams.get('epoch') !== s.epoch;
        const cursor = name => reset ? 0 : Math.max(0, Number(url.searchParams.get(name)) || 0);
        const trace = delta(snapshot.trace || [], cursor('after'));
        const callbacks = delta(s.receiver.records, cursor('callbackAfter'), 20);
        const { trace: ignored, queue = [], ...summary } = snapshot;
        return json(res, 200, { ...summary, queue: queue.slice(0, 100), queueLength: queue.length,
          epoch: s.epoch, reset, trace: operation === 'export' ? snapshot.trace || [] : trace.items,
          traceCursor: trace.cursor, traceGap: trace.gap,
          callbacks: operation === 'export' ? s.receiver.records : callbacks.items,
          callbackCursor: callbacks.cursor, callbackGap: callbacks.gap,
          cache: { trace: s.client?.traceBuffer.stats(), callbacks: s.receiver.buffer.stats() },
          callbackUrl: s.callbackUrl, demoUrl: s.demo?.url, scenarioRunning: s.scenarioRunning, scenarioRun: s.scenarioRun || null, idleMinutes: idleMs / 60000 });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
      if (s.busy || (s.scenarioRunning && !['stop'].includes(operation))) return json(res, 409, { error: '会话操作正在执行，请稍后重试' });
      const input = await readJson(req);
      // Recheck after body read: another request may have started an operation.
      if (!sessions.has(s.id) || s.busy || (s.scenarioRunning && operation !== 'stop')) return json(res, 409, { error: '会话状态已变化，请重试' });
      if (operation === 'scenario' || operation === 'scenario-start') {
        if (!s.client?.running) throw new Error('请先连接');
        s.scenarioRunning = true;
        const run = { id: randomUUID(), status: 'running', startedAt: Date.now(), report: null };
        s.scenarioRun = run;
        const execute = async () => {
          try {
            run.report = await runScenario(s.client, input, { demoUrl: s.demo?.url, callbackUrl: s.callbackUrl }, s.receiver);
            run.status = run.report.passed ? 'passed' : 'failed';
          } catch (e) { run.status = 'failed'; run.report = { passed: false, error: e.message }; }
          finally { run.finishedAt = Date.now(); s.scenarioRunning = false; s.lastAccess = Date.now(); }
          return run.report;
        };
        if (operation === 'scenario-start') { void execute(); return json(res, 202, { runId: run.id }); }
        return json(res, 200, await execute());
      }
      s.busy = true;
      try {
        if (operation === 'connect') {
          await dispose(s); s.client = null; s.receiver.clear(); s.epoch = randomUUID(); s.scenarioRun = null;
          try {
            if (input.demo) s.demo = await createDemoBackend({ callbackUrl: s.localCallbackUrl });
            const config = { ...input.config, maxTrace: 2000, maxQueue: 10000 };
            if (s.demo) { config.url = s.demo.wsUrl; config.executionMs = 100; }
            if (!config.eventCallbackUrl) config.eventCallbackUrl = s.localCallbackUrl;
            s.client = new MockClient(config); s.client.start();
            await waitFor(() => s.client.snapshot().connected, 10000, '连接');
          } catch (e) { await dispose(s); throw e; }
          return json(res, 200, { ok: true });
        }
        if (operation === 'stop' || operation === 'delete') {
          await dispose(s);
          if (operation === 'delete') sessions.delete(s.id);
          return json(res, 200, { ok: true });
        }
        if (!s.client?.running) throw new Error('请先连接');
        if (operation === 'action') { await s.client.action(input); return json(res, 200, { ok: true }); }
        if (operation === 'rules') {
          if (!Array.isArray(input.rules)) throw new Error('rules 必须是数组');
          s.client.rules = input.rules; return json(res, 200, { ok: true });
        }
        if (operation === 'demo-command') {
          if (!s.demo) throw new Error('此按钮仅用于演示；真实环境请从后端API下发任务');
          const response = await fetch(s.demo.url + '/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(10000) });
          return json(res, response.status, await response.json());
        }
        return json(res, 404, { error: 'Not found' });
      } finally { s.busy = false; s.lastAccess = Date.now(); }
    } catch (e) { if (!res.writableEnded) json(res, 400, { error: e.message }); }
  });
  await listen(server, port, host);
  localUrl = `http://127.0.0.1:${server.address().port}`;
  const timer = setInterval(() => { void sweep().catch(e => console.error('清理会话失败:', e.message)); }, 60000); timer.unref();
  return { url: localUrl, sessions, sweep, async close() {
    closing = true; clearInterval(timer);
    await Promise.all([...sessions.values()].map(dispose)); sessions.clear();
    await new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createControlServer({ port: Number(process.env.PORT || 8787), publicUrl: process.env.PUBLIC_URL || '',
    trustProxyAuth: process.env.TRUST_PROXY_AUTH === '1', maxSessions: Number(process.env.MAX_SESSIONS || 4),
    idleMs: Number(process.env.SESSION_IDLE_MINUTES ?? 30) * 60000,
    host: process.env.HOST || '127.0.0.1', serviceKey: process.env.MOCK_CLIENT_SERVICE_KEY || '' });
  console.log(`WorkTool 模拟客户端：${app.url}`);
  process.once('SIGINT', () => void app.close()); process.once('SIGTERM', () => void app.close());
}
