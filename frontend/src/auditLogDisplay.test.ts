import { describe, it, expect } from 'vitest';
import { auditValue, licenseScope } from './auditLogDisplay';
describe('audit display', () => {
  it('falls back to historical input remark', () => expect(auditValue({before:{remark:'中华私有云'},after:{expire_date:'2029-10-31'}}, 'remark')).toBe('中华私有云'));
  it('prefers output and preserves cleared values', () => {
    for (const value of ['', null, false, 0]) expect(auditValue({before:{remark:'old'},after:{remark:value}},'remark')).toBe(value);
  });
  it('handles malformed historical details', () => expect(auditValue({before:null,after:'bad'},'remark')).toBeUndefined());
  it('shows unrestricted correctly', () => expect(licenseScope({before:{restrict_robot:false},after:{}})).toBe('不限制'));
  it('shows limits', () => expect(licenseScope({before:{restrict_robot:true,robot_limit:3,robot_start:'a',robot_end:'b'},after:{}})).toBe('数量：3；范围：a ～ b'));
  it('does not infer unrestricted from missing value', () => expect(licenseScope({before:{},after:{}})).toBe('-'));
});
