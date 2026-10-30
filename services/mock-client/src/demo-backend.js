// 仅为工具自测的协议对端，不替代真实 Java 后端回归。
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { envelope, encode, decode } from './protocol.js';
import { listen, readJson, json } from './receiver.js';
import { RecordBuffer } from './buffer.js';

export async function createDemoBackend({ callbackUrl } = {}) {
  let sequence = 1; const sockets = new Set(), buffer = new RecordBuffer(2000, 2 * 1024 * 1024), records = buffer.items, pending = new Map();
  const cleanup = () => { for (const [id, value] of pending) if (Date.now() - value.at > 30 * 60 * 1000) pending.delete(id); };
  const timer = setInterval(cleanup, 60000); timer.unref();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/send' && req.method === 'POST') {
        const input = await readJson(req), socket = [...sockets].at(-1);
        if (!socket) return json(res, 409, { code: 409, message: '机器人未连接' });
        const packet = envelope(2, input.list || [input.command], input.messageId || `mock-${sequence++}`);
        packet.apiSend = input.apiSend ?? 1; cleanup();
        pending.set(packet.messageId, { apiSend: packet.apiSend, remaining: packet.list.length, at: Date.now() });
        if (pending.size > 1000) pending.delete(pending.keys().next().value);
        socket.send(encode(packet, input.encrypted));
        return json(res, 200, { code: 200, data: { messageId: packet.messageId } });
      }
      if (req.url === '/config') return json(res, 200, { code: 200, data: { callbackUrl, eventCallbackEnabled: true } });
      json(res, 404, { code: 404 });
    } catch (e) { json(res, 400, { error: e.message }); }
  });
  const ws = new WebSocketServer({ server, maxPayload: 16 * 1024 * 1024 });
  ws.on('connection', (socket, req) => {
    sockets.add(socket); buffer.push({ kind: 'connection', url: req.url, headers: req.headers });
    socket.send(encode({ ...envelope(2, [{ type: 503 }], `mock-${sequence++}`), apiSend: 0 }));
    socket.on('message', async bytes => {
      try {
        const packet = decode(bytes.toString()); buffer.push({ kind: 'packet', packet });
        if (packet.type === 11) socket.send(JSON.stringify({ type: 11 }));
        const task = pending.get(packet.messageId);
        if (packet.socketType === 3 && task) {
          if (--task.remaining <= 0) pending.delete(packet.messageId);
        }
        if (packet.socketType === 3 && task?.apiSend > 0 && callbackUrl) {
          const item = packet.list[0], type = JSON.parse(item.rawMsg).type;
          if (type !== 514) {
            const response = await fetch(callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...item, messageId: packet.messageId, type }), signal: AbortSignal.timeout(5000) });
            await response.body?.cancel();
          }
        }
      } catch (e) { buffer.push({ kind: 'error', message: e.message }); }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  const url = await listen(server);
  return { url, wsUrl: url.replace('http:', 'ws:') + '/webserver/wework/mock-robot', records, buffer, pending,
    close: async () => { clearInterval(timer); pending.clear(); for (const s of sockets) s.terminate(); await new Promise(r => ws.close(r)); await new Promise(r => server.close(r)); } };
}
