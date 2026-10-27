type AuditDetails = { before: unknown; after: unknown };
export function auditValue(row: AuditDetails, key: string): unknown {
  // An explicit null/empty/false in after is meaningful; only absent keys fall back.
  for (const value of [row.after, row.before]) {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
      return (value as Record<string, unknown>)[key];
    }
  }
  return undefined;
}
export function licenseScope(row: AuditDetails): string {
  const restricted = auditValue(row, 'restrict_robot');
  if (restricted === false) return '不限制';
  if (restricted !== true) return '-';
  const limit = auditValue(row, 'robot_limit');
  const start = auditValue(row, 'robot_start');
  const end = auditValue(row, 'robot_end');
  return [limit != null ? `数量：${limit}` : '', start != null || end != null ? `范围：${start ?? '-'} ～ ${end ?? '-'}` : ''].filter(Boolean).join('；') || '已限制';
}
