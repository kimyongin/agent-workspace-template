// list_records and get_record both return canonical recordResult including full body.
// Search snippets never qualify, even if they happen to contain the fixture code.
export function hasOriginalRecord(tool, payload, source) {
  if (!['get_record', 'list_records'].includes(tool)) return false;
  if (typeof payload === 'string') { try { return hasOriginalRecord(tool, JSON.parse(payload), source); } catch { return false; } }
  if (!payload || typeof payload !== 'object') return false;
  if (payload.id === source.id && payload.body === source.body && payload.version === source.version) return true;
  return Object.values(payload).some(value => hasOriginalRecord(tool, value, source));
}
