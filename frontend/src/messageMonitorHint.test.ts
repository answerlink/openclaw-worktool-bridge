import { describe, expect, it } from 'vitest';
import { canCheckMessageCallback, messageCallbackHint } from './messageMonitorHint';

const settings = { callback_example_url: 'https://console.example/api/v1/callback/qa/{robot_id}' };
const detail = { code: 200, data: {} };
const callback = (url: string, enabled = true) => ({ type: 11, callBackUrl: url, enabled });
const hint = (data: unknown[], d: any = detail) => messageCallbackHint({ code: 200, data }, d, settings, 'https://browser.example', 'wt1');

describe('message monitor empty state', () => {
  it('only checks the unfiltered first page with a confirmed empty result', () => {
    expect(canCheckMessageCallback(1, 'all', '', 0, 0)).toBe(true);
    for (const args of [[2, 'all', '', 0, 0], [1, 'group', '', 0, 0], [1, 'all', '客户', 0, 0], [1, 'all', '', 10, 0], [1, 'all', '', 0, 1]] as const) {
      expect(canCheckMessageCallback(args[0], args[1], args[2], args[3], args[4])).toBe(false);
    }
  });
  it('distinguishes absent, external and platform receivers', () => {
    expect(hint([])).toBe('missing');
    expect(hint([callback('')])).toBe('missing');
    expect(hint([callback('https://customer.example/callback')])).toBe('external');
    expect(hint([callback('https://console.example/api/v1/callback/qa/wt1/')])).toBe(null);
    expect(hint([callback('https://console.example/api/v1/callback/qa/another')])).toBe('external');
  });
  it('respects disabled callbacks and ignores unrelated callback types', () => {
    expect(hint([callback('https://customer.example', false)])).toBe('missing');
    expect(hint([{ type: 5, callBackUrl: 'https://customer.example/status' }])).toBe('missing');
  });
  it('recognizes legacy message configuration instead of calling it missing', () => {
    expect(hint([], { code: 200, data: { callbackUrl: 'https://customer.example/legacy' } })).toBe('external');
  });
  it('never labels failed or malformed responses as missing', () => {
    for (const response of [null, {}, { code: 500, data: [] }, { code: 200, data: {} }, { code: 200, data: [null] }]) {
      expect(messageCallbackHint(response, detail, settings, 'https://browser.example', 'wt1')).toBe(null);
    }
    expect(messageCallbackHint({ code: 200, data: [] }, { code: 500 }, settings, '', 'wt1')).toBe(null);
    expect(messageCallbackHint({ code: 200, data: [] }, detail, {}, '', 'wt1')).toBe(null);
  });
});
