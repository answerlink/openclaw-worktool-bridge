import { describe, expect, it } from 'vitest';
import { commandBody, commandContent } from './commandContent';

describe('command content across command and result responses', () => {
  const message = { receivedContent: '测试指令内容', type: 203, titleList: ['测试群'] };
  it('preserves content for original commands and different rawMsg representations', () => {
    for (const raw of [message, JSON.stringify(message), JSON.stringify(JSON.stringify(message)),
      { list: [message] }, { body: JSON.stringify({ list: [message] }) }, [message]]) {
      expect(commandContent(JSON.stringify(commandBody(raw)))).toBe('测试指令内容');
    }
  });
  it('displays file names and handles missing payloads', () => {
    expect(commandContent({ objectName: '报告.pdf', fileUrl: 'https://example.com/file' })).toBe('报告.pdf');
    expect(commandContent(null)).toBe('');
    expect(commandContent('invalid')).toBe('');
  });
});
