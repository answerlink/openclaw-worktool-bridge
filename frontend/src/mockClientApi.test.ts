import { describe, expect, it } from 'vitest';
import { emptyCursor, mergeMockRecords, mockWebSocketUrl, parseMockObject } from './mockClientApi';

describe('Console配置生成模拟连接地址', () => {
  it('官方HTTPS地址转换为WSS', () => {
    expect(mockWebSocketUrl('https://api.worktool.ymdyes.cn/', 'wt11a')).toBe('wss://api.worktool.ymdyes.cn/webserver/wework/wt11a');
  });
  it('保留私有部署端口和路径前缀', () => {
    expect(mockWebSocketUrl('http://intranet:8081/prefix/', 'robot test')).toBe('ws://intranet:8081/prefix/webserver/wework/robot%20test');
  });
  it('缺失或不合法配置不能静默连接默认服务器', () => {
    for (const base of ['', 'ftp://server', 'https://server?key=x', 'https://user:pass@server']) expect(() => mockWebSocketUrl(base, 'wt11a')).toThrow();
    expect(() => mockWebSocketUrl('https://server', ' ')).toThrow();
  });
});

describe('模拟会话增量状态', () => {
  it('重连epoch重置时不混入旧会话记录', () => {
    expect(mergeMockRecords([{ seq: 90, at: 1 }], [{ seq: 1, at: 2 }], true, 150)).toEqual([{ seq: 1, at: 2 }]);
  });
  it('重复增量不重复展示，按序保留最新记录', () => {
    expect(mergeMockRecords([{ seq: 1, at: 1 }, { seq: 2, at: 1 }], [{ seq: 2, at: 2 }, { seq: 3, at: 3 }], false, 2)).toEqual([{ seq: 2, at: 2 }, { seq: 3, at: 3 }]);
  });
  it('无新记录仍保持现有记录', () => {
    expect(mergeMockRecords([{ seq: 1, at: 1 }], [], false, 150)).toHaveLength(1);
  });
  it('每次新建游标独立', () => {
    const a = emptyCursor(); a.after = 12; expect(emptyCursor().after).toBe(0);
  });
  it('拒绝数组、空值和非法JSON作为指令对象', () => {
    for (const value of ['[]', 'null', '"text"', '{']) expect(() => parseMockObject(value)).toThrow();
    expect(parseMockObject('{"type":203}')).toEqual({ type: 203 });
  });
});
