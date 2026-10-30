import { randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';

export const id = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', '#') + '#' + randomUUID();
const key = Buffer.from('9876543210abcdef');
const iv = Buffer.from('0123456789abcdef');
export function envelope(socketType, list = [], messageId = id(), meta) {
  return { socketType, messageId, encryptType: 0, encryptedList: '', list, ...(meta == null ? {} : { meta }) };
}
export function encode(packet, encrypted = false) {
  if (!encrypted || !Array.isArray(packet.list)) return JSON.stringify(packet);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  return JSON.stringify({ ...packet, encryptType: 1, list: [], encryptedList:
    Buffer.concat([cipher.update(JSON.stringify(packet.list), 'utf8'), cipher.final()]).toString('hex').toUpperCase() });
}
export function decode(text) {
  const packet = JSON.parse(text);
  if (packet.encryptType === 1) {
    const cipher = createDecipheriv('aes-128-cbc', key, iv);
    packet.list = JSON.parse(Buffer.concat([cipher.update(Buffer.from(packet.encryptedList, 'hex')), cipher.final()]).toString());
  }
  return packet;
}
export function result(command, started, options = {}) {
  const raw = structuredClone(command);
  if (raw.fileBase64?.length > 100) raw.fileBase64 = raw.fileBase64.slice(0, 100);
  const reason = options.errorReason || '';
  const failList = (options.failList || []).map(x => x.includes('失败原因:') ? x : `${x} 失败原因: ${reason || '执行失败'}`);
  return envelope(3, [{ type: 0, rawMsg: JSON.stringify(raw), errorCode: options.errorCode ?? 0,
    errorReason: reason || (failList.length ? `部分目标执行失败: ${failList.join(', ')}` : ''),
    runTime: started, timeCost: (Date.now() - started) / 1000,
    successList: options.successList || [], failList,
    ...Object.fromEntries(['metaJson', 'filePath', 'log'].filter(k => options[k] !== undefined).map(k => [k, options[k]]))
  }], command.messageId, command.meta);
}
export function callbackRequest(address, token) {
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('回调仅支持 HTTP/HTTPS');
  const headers = { 'content-type': 'application/json', ...(token ? { token } : {}) };
  for (const [name, value] of [...url.searchParams]) {
    if (name.toLowerCase().startsWith('x-')) { headers[name.toLowerCase()] = value; url.searchParams.delete(name); }
  }
  return { url, headers };
}
export function mask(value) {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, /token|password|secret|authorization/i.test(k) ? '***' : k === 'fileBase64' ? `[base64 ${String(v).length} chars]` : mask(v)]));
  if (typeof value === 'string' && /^https?:|^wss?:/.test(value)) {
    try { const u = new URL(value); for (const k of u.searchParams.keys()) if (/token|key|secret/i.test(k)) u.searchParams.set(k, '***'); return u.toString(); } catch {}
  }
  return value;
}
