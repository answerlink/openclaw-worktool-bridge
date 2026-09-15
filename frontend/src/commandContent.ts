export function parseCommandPayload(raw: unknown): any {
  let value = raw;
  for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' ? value : null;
}

export function commandBody(raw: unknown): { list: any[] } {
  const payload = parseCommandPayload(raw);
  if (!payload) return { list: [] };
  if (Array.isArray(payload)) return { list: payload };
  if (Array.isArray(payload.list)) return payload;
  if (payload.body != null) return commandBody(payload.body);
  return { list: [payload] };
}

export function commandContent(raw: unknown): string {
  const first = commandBody(raw).list[0];
  return String(first?.receivedContent || first?.extraText || first?.objectName || first?.fileUrl || '').trim();
}
