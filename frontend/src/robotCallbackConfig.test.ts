import { describe, expect, it } from 'vitest';
import { withLegacyMessageCallback, mergeOnlineStatusCallbacks, callbackAddressLabel, getCallbackReplacements, isPlatformCallback, isWecomWebhook, resolvePlatformCallback } from './robotCallbackConfig';

describe('platform callback recognition', () => {
  it('uses the configured public address rather than the browser origin', () => {
    expect(resolvePlatformCallback('https://public.example/api/v1/callback/qa/{robot_id}', 'http://localhost', 'wt1')).toBe('https://public.example/api/v1/callback/qa/wt1');
    expect(resolvePlatformCallback('', 'http://localhost', 'wt1')).toBe('http://localhost/api/v1/callback/qa/wt1');
  });
  it('does not identify an external receiver or an empty callback as connected', () => {
    const platform = 'https://public.example/api/v1/callback/qa/wt1';
    expect(isPlatformCallback(`${platform}/`, platform)).toBe(true);
    expect(isPlatformCallback('https://other.example/api/v1/callback/qa/wt1', platform)).toBe(false);
    expect(isPlatformCallback('', '')).toBe(false);
  });
});

describe('beginner notification address validation', () => {
  it('accepts the complete WeCom message push address', () => {
    expect(isWecomWebhook(' https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key ')).toBe(true);
  });
  it.each([
    '', 'not-a-url', 'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
    'https://qyapi.weixin.qq.com.evil.example/cgi-bin/webhook/send?key=test',
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send',
    'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=',
    'https://qyapi.weixin.qq.com/other?key=test',
    'https://user:pass@qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test'
  ])('rejects incomplete or incorrect address %s', (url) => expect(isWecomWebhook(url)).toBe(false));
});

describe('callback overwrite protection', () => {
  const saved = [
    { type: 11, typeName: '消息回调', callBackUrl: 'https://custom.example/messages' },
    { type: 1, typeName: '指令执行结果', callBackUrl: 'https://custom.example/results' },
    { type: 5, typeName: '上线通知', callBackUrl: 'https://custom.example/online' },
    { type: 6, typeName: '掉线通知', callBackUrl: '' },
  ];
  it('requires confirmation only for nonempty addresses being replaced', () => {
    expect(getCallbackReplacements(saved, [11], 'https://platform.example/messages')).toEqual([saved[0]]);
    expect(getCallbackReplacements(saved, [11], ' https://custom.example/messages ')).toEqual([]);
    expect(getCallbackReplacements(saved, [0, 6], 'https://new.example/callback')).toEqual([]);
  });
  it('checks both online and offline addresses without touching other types', () => {
    expect(getCallbackReplacements(saved, [5, 6], 'https://new.example/status')).toEqual([saved[2]]);
    const split = [...saved, { type: 6, typeName: '掉线通知', callBackUrl: 'https://custom.example/offline' }];
    expect(getCallbackReplacements(split, [5, 6], 'https://custom.example/online')).toEqual([split[4]]);
  });
});

describe('callback address display', () => {
  const platform = 'https://platform.example/api/v1/callback/qa/demo';
  it('hides platform message addresses and preserves custom addresses', () => {
    expect(callbackAddressLabel(11, platform, platform)).toBe('由本平台接收消息');
    expect(callbackAddressLabel(11, 'https://custom.example/messages', platform)).toBe('https://custom.example/messages');
    expect(callbackAddressLabel(5, 'https://custom.example/status', platform)).toBe('https://custom.example/status');
  });
});

describe('online status callback display', () => {
  const online = { type: 5, typeName: '机器人上线回调', callBackUrl: 'https://example.com/status' };
  const offline = { type: 6, typeName: '机器人下线回调', callBackUrl: online.callBackUrl };
  const message = { type: 11, typeName: '消息回调', callBackUrl: online.callBackUrl };
  it('combines matching status callbacks and retains both deletion types', () => {
    const source = [message, online, offline];
    expect(mergeOnlineStatusCallbacks(source)).toEqual([
      { ...message, callbackTypes: [11] },
      { ...online, typeName: '机器人上下线回调', callbackTypes: [5, 6] },
    ]);
    expect(source).toEqual([message, online, offline]);
  });
  it('also combines callbacks supplied in reverse order', () => {
    expect(mergeOnlineStatusCallbacks([offline, online])).toEqual([
      { ...offline, type: 5, typeName: '机器人上下线回调', callbackTypes: [5, 6] },
    ]);
  });
  it('keeps different addresses and missing counterparts separate', () => {
    const different = { ...offline, callBackUrl: 'https://example.com/other' };
    expect(mergeOnlineStatusCallbacks([online, different])).toEqual([
      { ...online, callbackTypes: [5] }, { ...different, callbackTypes: [6] },
    ]);
    expect(mergeOnlineStatusCallbacks([offline])).toEqual([{ ...offline, callbackTypes: [6] }]);
  });
  it('does not combine unconfigured empty addresses', () => {
    expect(mergeOnlineStatusCallbacks([{ ...online, callBackUrl: '' }, { ...offline, callBackUrl: '' }])).toHaveLength(2);
  });
});

describe('legacy message callback compatibility', () => {
  it('shows a real binding stored only in robot detail', () => {
    expect(withLegacyMessageCallback([], { callbackUrl: 'https://example.com/callback' })).toEqual([
      { type: 11, typeName: '消息回调', callBackUrl: 'https://example.com/callback' },
    ]);
  });
  it('keeps explicit callback list values and does not create empty bindings', () => {
    const rows = [{ type: 11, typeName: '消息回调', callBackUrl: 'https://example.com/new' }];
    expect(withLegacyMessageCallback(rows, { callbackUrl: 'https://example.com/old' })).toBe(rows);
    expect(withLegacyMessageCallback([], { callbackUrl: '' })).toEqual([]);
  });
});

describe('event callback display', () => {
  it('labels an inherited address and retains a disabled event row', () => {
    expect(callbackAddressLabel(7, '', '')).toBe('沿用消息回调地址');
    const event = { type: 7, typeName: '事件回调', callBackUrl: '', enabled: false };
    expect(mergeOnlineStatusCallbacks([event])).toEqual([{ ...event, callbackTypes: [7] }]);
  });
});
