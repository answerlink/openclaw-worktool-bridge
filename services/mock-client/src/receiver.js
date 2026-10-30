import http from 'node:http';
import { RecordBuffer } from './buffer.js';

export async function readJson(request, max = 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > max) throw new Error('请求体超过限制'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
export const json = (response, status, data) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
export async function listen(server, port = 0, host = '127.0.0.1') {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return `http://${host}:${server.address().port}`;
}
export function createCallbackStore() {
  const buffer = new RecordBuffer(1000, 8 * 1024 * 1024);
  let sequence = 0;
  return { records: buffer.items, buffer,
    accept(body, path) { buffer.push({ seq: ++sequence, at: Date.now(), path, body }); },
    clear() { buffer.clear(); } };
}
export async function createReceiver(port = 0) {
  const store = createCallbackStore(), records = store.records;
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') return json(res, 404, { code: 404 });
    try { const body = await readJson(req); store.accept(body, req.url);
      json(res, 200, { code: 200, message: 'success' });
    } catch (e) { json(res, 400, { error: e.message }); }
  });
  const url = await listen(server, port);
  return { records, url, close: () => new Promise(resolve => server.close(resolve)) };
}
