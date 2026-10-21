import dayjs from 'dayjs';

export type RenewMonths = 1 | 3 | 12;

export function parseRenewRobotIds(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

export function batchRenewDate(expiry: string | null | undefined, months: RenewMonths, today = dayjs()): string {
  const current = expiry ? dayjs(expiry) : null;
  if (current && !current.isValid()) throw new Error('当前到期时间格式异常，未执行续期');
  const base = current && current.isAfter(today, 'day') ? current : today;
  return base.add(months, 'month').format('YYYY-MM-DD');
}
