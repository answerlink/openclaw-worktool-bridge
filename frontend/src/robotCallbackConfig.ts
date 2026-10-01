export type ConfigMode = 'beginner' | 'custom';

export function resolvePlatformCallback(template: string, origin: string, robotId: string) {
  return (template.trim() || `${origin}/api/v1/callback/qa/{robot_id}`).replace('{robot_id}', robotId);
}

export function isPlatformCallback(current: string, expected: string) {
  return Boolean(current.trim()) && current.trim().replace(/\/+$/, '') === expected.trim().replace(/\/+$/, '');
}

export function isWecomWebhook(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'qyapi.weixin.qq.com'
      && !url.port && !url.username && !url.password
      && url.pathname === '/cgi-bin/webhook/send' && Boolean(url.searchParams.get('key')?.trim());
  } catch {
    return false;
  }
}

interface SavedCallback {
  type: number;
  typeName: string;
  callBackUrl: string;
}

export function getCallbackReplacements(callbacks: SavedCallback[], types: number[], nextUrl: string) {
  const target = nextUrl.trim();
  return callbacks.filter((item) => types.includes(item.type)
    && Boolean(item.callBackUrl.trim()) && item.callBackUrl.trim() !== target);
}

export function callbackAddressLabel(type: number, url: string, platformUrl: string) {
  return type === 11 && isPlatformCallback(url, platformUrl) ? '由本平台接收消息' : url;
}

export interface CallbackDisplayItem extends SavedCallback {
  callbackTypes: number[];
}

export function mergeOnlineStatusCallbacks(callbacks: SavedCallback[]): CallbackDisplayItem[] {
  const online = callbacks.find((item) => item.type === 5);
  const offline = callbacks.find((item) => item.type === 6);
  const merge = Boolean(online?.callBackUrl.trim())
    && online?.callBackUrl.trim() === offline?.callBackUrl.trim();
  let statusAdded = false;
  return callbacks.flatMap((item) => {
    if (merge && (item.type === 5 || item.type === 6)) {
      if (statusAdded) return [];
      statusAdded = true;
      return [{ ...item, type: 5, typeName: '机器人上下线回调', callbackTypes: [5, 6] }];
    }
    return [{ ...item, callbackTypes: [item.type] }];
  });
}

export function withLegacyMessageCallback(callbacks: SavedCallback[], detail: { callbackUrl?: string }) {
  if (callbacks.some((item) => item.type === 11) || !detail?.callbackUrl?.trim()) return callbacks;
  return [{ type: 11, typeName: '消息回调', callBackUrl: detail.callbackUrl.trim() }, ...callbacks];
}
