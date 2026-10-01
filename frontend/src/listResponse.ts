// Reject malformed responses before undefined can enter list state.
export function readListItems(payload: any, name: string): any[] {
  if (!Array.isArray(payload?.items)) {
    throw new Error(`${name}返回格式异常，请重新加载`);
  }
  return payload.items;
}
