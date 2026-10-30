import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export function get(object, path) { return path.split('.').reduce((v, k) => v?.[k], object); }
export function matches(object, expected) {
  return Object.entries(expected || {}).every(([path, value]) => JSON.stringify(get(object, path)) === JSON.stringify(value));
}
export function expand(value, variables) {
  if (typeof value === 'string') return value.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const resolved = get(variables, key); if (resolved === undefined) throw new Error(`未定义变量 ${key}`); return resolved;
  });
  if (Array.isArray(value)) return value.map(v => expand(v, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, variables)]));
  return value;
}
export async function waitFor(predicate, timeoutMs = 10000, label = '条件') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (predicate()) return; await sleep(10); }
  throw new Error(`等待超时: ${label}`);
}
export async function loadScenario(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function runScenario(client, scenario, variables = {}, receiver = { records: [] }) {
  const started = Date.now(), checks = [], baseline = client.sequence;
  const speed = scenario.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('speed 必须大于0');
  try {
    for (const raw of scenario.steps || []) {
      if (!client.running) throw new Error('模拟客户端已停止');
      const step = expand(raw, variables);
      if (step.atMs !== undefined) {
        const remaining = started + step.atMs / speed - Date.now();
        if (remaining > 0 && !(await client.delay(remaining))) throw new Error('场景已停止');
      }
      if (step.action === 'wait') {
        if (!(await client.delay(step.ms / speed))) throw new Error('场景已停止');
      } else if (step.action === 'http') {
        const response = await fetch(step.url, { method: step.method || 'POST',
          headers: { 'content-type': 'application/json', ...step.headers },
          ...(step.body === undefined ? {} : { body: JSON.stringify(step.body) }), signal: AbortSignal.timeout(step.timeoutMs || 10000) });
        const body = await response.json();
        if (response.status !== (step.status || 200) || !matches(body, step.expect)) throw new Error(`HTTP 断言失败: status=${response.status}`);
        if (step.saveAs) variables[step.saveAs] = body;
        client.record('scenarioHttp', { url: step.url, status: response.status });
      } else if (step.action === 'assert') {
        const count = () => (step.source === 'callbacks' ? receiver.records : client.trace.filter(x => x.seq > baseline)).filter(x => matches(x, step.match)).length;
        const expected = step.count ?? 1;
        await waitFor(() => client.running && count() >= expected, step.timeoutMs || 10000, step.name || JSON.stringify(step.match));
        if (step.exact && count() !== expected) throw new Error(`数量不符: ${count()} != ${expected}`);
        checks.push({ name: step.name || 'assert', passed: true, count: count() });
      } else await client.action(step);
    }
    return { passed: true, elapsedMs: Date.now() - started, checks, metrics: { ...client.metrics } };
  } catch (error) {
    return { passed: false, elapsedMs: Date.now() - started, checks, error: error.message, metrics: { ...client.metrics } };
  }
}
