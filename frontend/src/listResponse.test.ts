import { describe, expect, it } from 'vitest';
import { readListItems } from './listResponse';

describe('list response validation', () => {
  it('accepts both empty and populated list responses', () => {
    expect(readListItems({ items: [] }, '列表')).toEqual([]);
    expect(readListItems({ items: [{ id: 1 }] }, '列表')).toEqual([{ id: 1 }]);
  });
  it.each([undefined, null, {}, { data: {} }, { items: null }, { items: {} }])('rejects malformed responses before rendering: %s', (payload) => {
    expect(() => readListItems(payload, '回复规则列表')).toThrow('回复规则列表返回格式异常');
  });
});
