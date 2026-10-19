import { isPlatformCallback, resolvePlatformCallback, withLegacyMessageCallback } from './robotCallbackConfig';

export type MessageMonitorHint = 'missing' | 'external' | null;

export function canCheckMessageCallback(page: number, scene: string, keyword: string, total: number, rowCount: number) {
  return page === 1 && scene === 'all' && !keyword.trim() && total === 0 && rowCount === 0;
}

// A failed or malformed lookup must never be interpreted as missing configuration.
export function messageCallbackHint(callbacks: any, detail: any, settings: any, origin: string, robotId: string): MessageMonitorHint {
  const ok = (response: any) => response && [200, 0, '200', '0'].includes(response.code);
  if (!ok(callbacks) || !Array.isArray(callbacks.data) || !ok(detail)
    || !detail.data || typeof detail.data !== 'object' || !settings
    || typeof settings.callback_example_url !== 'string') return null;
  if (callbacks.data.some((item: any) => !item || typeof item.type !== 'number' || typeof item.callBackUrl !== 'string')) return null;
  const items = withLegacyMessageCallback(callbacks.data, detail.data);
  const messages = items.filter((item: any) => item.type === 11 && item.enabled !== false && item.callBackUrl.trim());
  if (!messages.length) return 'missing';
  const expected = resolvePlatformCallback(settings.callback_example_url, origin, robotId);
  return messages.some((item: any) => isPlatformCallback(item.callBackUrl, expected)) ? null : 'external';
}
