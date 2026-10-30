import { http } from './api';

export type MockRecord = { seq: number; at: number; kind?: string; messageId?: string; [key: string]: unknown };
export type MockSession = { id: string; robotId: string; connected: boolean; running: boolean; scenarioRunning: boolean };
export type MockRun = { id: string; status: 'running' | 'passed' | 'failed'; startedAt: number; finishedAt?: number; report: unknown };
export type MockState = {
  epoch: string; reset: boolean; trace: MockRecord[]; callbacks: MockRecord[];
  traceCursor: number; callbackCursor: number; traceGap: boolean; callbackGap: boolean;
  connected?: boolean; running?: boolean; paused?: boolean; heartbeatEnabled?: boolean;
  queueLength?: number; pendingUploads?: number; active?: { messageId: string; type: number };
  metrics?: { received: number; acknowledgements: number; results: number; callbacks: number; callbackFailures: number; duplicate: number };
  callbackUrl: string; demoUrl?: string; scenarioRunning: boolean; scenarioRun?: MockRun;
  idleMinutes: number; cache?: { trace?: { count: number; bytes: number }; callbacks?: { count: number; bytes: number } };
};
export type Cursor = { epoch: string; after: number; callbackAfter: number };
export const emptyCursor = (): Cursor => ({ epoch: '', after: 0, callbackAfter: 0 });
export function mockWebSocketUrl(baseUrl: string, robotId: string): string {
  const base = new URL(baseUrl.trim());
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Console 后端地址需要有效的 HTTP/HTTPS baseurl');
  if (!robotId.trim()) throw new Error('请输入测试机器人 ID');
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = `${base.pathname.replace(/\/$/, '')}/webserver/wework/${encodeURIComponent(robotId.trim())}`;
  return base.toString();
}
export function mergeMockRecords(previous: MockRecord[], incoming: MockRecord[], reset: boolean, limit: number): MockRecord[] {
  const records = new Map((reset ? [] : previous).map(r => [r.seq, r]));
  incoming.forEach(r => records.set(r.seq, r));
  return [...records.values()].sort((a, b) => a.seq - b.seq).slice(-limit);
}
export function parseMockObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请输入JSON对象');
  return parsed;
}
const root = '/admin/mock-client/sessions';
export const mockApi = {
  list: () => http.get<{ sessions: MockSession[]; maxSessions: number; idleMinutes: number }>(root).then(r => r.data),
  create: () => http.post<{ id: string }>(root, {}).then(r => r.data),
  state: (id: string, cursor: Cursor, signal?: AbortSignal) => http.get<MockState>(`${root}/${id}/state`, { params: cursor, signal }).then(r => r.data),
  operate: (id: string, operation: 'connect' | 'stop' | 'delete' | 'action' | 'rules' | 'demo-command' | 'scenario-start', body: unknown = {}) =>
    http.post(`${root}/${id}/${operation}`, body).then(r => r.data),
  export: (id: string) => http.get(`${root}/${id}/export`).then(r => r.data),
};
