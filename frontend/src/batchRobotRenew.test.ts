import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { batchRenewDate, parseRenewRobotIds } from './batchRobotRenew';

describe('batch renewal', () => {
  it('trims lines, ignores blanks and deduplicates without restricting legacy IDs', () => {
    expect(parseRenewRobotIds(' worktool1\r\n\nwt123\nworktool1\n wc123 ')).toEqual(['worktool1', 'wt123', 'wc123']);
  });
  it('preserves remaining time and uses calendar months at month end', () => {
    expect(batchRenewDate('2027-01-31 23:59:59', 1, dayjs('2026-10-21'))).toBe('2027-02-28');
    expect(batchRenewDate('2027-01-31 23:59:59', 3, dayjs('2026-10-21'))).toBe('2027-04-30');
    expect(batchRenewDate('2028-02-29 23:59:59', 12, dayjs('2026-10-21'))).toBe('2029-02-28');
  });
  it('starts expired and unset authorizations from today', () => {
    for (const expiry of ['', null, '2020-01-01']) {
      expect(batchRenewDate(expiry, 1, dayjs('2026-10-21'))).toBe('2026-11-21');
      expect(batchRenewDate(expiry, 3, dayjs('2026-10-21'))).toBe('2027-01-21');
      expect(batchRenewDate(expiry, 12, dayjs('2026-10-21'))).toBe('2027-10-21');
    }
  });
  it('does not silently renew when expiry is unreadable', () => {
    expect(() => batchRenewDate('invalid', 1)).toThrow('当前到期时间格式异常');
  });
});
