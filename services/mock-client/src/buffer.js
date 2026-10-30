// Limits are UTF-8 JSON bytes, not a promise about V8 heap size.
export class RecordBuffer {
  constructor(maxCount, maxBytes) {
    this.maxCount = maxCount; this.maxBytes = maxBytes;
    this.items = []; this.sizes = []; this.bytes = 0; this.evicted = 0;
  }
  push(value) {
    let size = Buffer.byteLength(JSON.stringify(value));
    if (size > this.maxBytes) {
      value = { seq: value.seq, at: value.at, kind: value.kind, truncated: true, originalBytes: size,
        messageId: value.messageId, notice: '单条记录超过缓存容量，未保留内容' };
      size = Buffer.byteLength(JSON.stringify(value));
    }
    while (this.items.length && (this.items.length >= this.maxCount || this.bytes + size > this.maxBytes)) {
      this.items.shift(); this.bytes -= this.sizes.shift(); this.evicted++;
    }
    if (size <= this.maxBytes) { this.items.push(value); this.sizes.push(size); this.bytes += size; }
    return value;
  }
  clear() { this.items.length = 0; this.sizes.length = 0; this.bytes = 0; this.evicted = 0; }
  stats() { return { count: this.items.length, bytes: this.bytes, evicted: this.evicted }; }
}

// Bounded incremental response; a large entry gets a preview instead of repeated megabyte transfers.
export function delta(items, after = 0, limit = 150, budget = 256 * 1024) {
  const result = []; let bytes = 0, cursor = after;
  for (const item of items) {
    if (item.seq <= after) continue;
    const text = JSON.stringify(item);
    const entry = Buffer.byteLength(text) > 64 * 1024
      ? { seq: item.seq, at: item.at, kind: item.kind, truncated: true, originalBytes: Buffer.byteLength(text), preview: text.slice(0, 16000) }
      : item;
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (result.length && (result.length >= limit || bytes + size > budget)) break;
    result.push(entry); bytes += size; cursor = item.seq;
  }
  return { items: result, cursor, gap: Boolean(after && items.length && after < items[0].seq - 1) };
}
