// Independent business reads, never client inference or search-index completion.
import { createHash } from 'node:crypto';

export async function readPreparationState(call) {
  const state = await readBusinessOriginals(call);
  return { digest: createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex'), counts: Object.fromEntries(Object.entries(state).filter(([, rows]) => Array.isArray(rows)).map(([kind, rows]) => [kind, rows.length])) };
}

export async function readBusinessOriginals(call) {
  const state = {};
  for (const kind of ['entities', 'tasks', 'records', 'tags']) {
    const scopes = kind === 'tags' ? [{ scope: 'entity' }, { scope: 'task' }, { scope: 'record' }] : [{}];
    const rows = [];
    for (const scope of scopes) {
      let cursor; const seen = new Set();
      do {
        const page = await call(`list_${kind}`, { ...scope, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(page.items)) throw new Error('Unexpected business inventory response');
        rows.push(...page.items); cursor = page.next_cursor;
        if (cursor && seen.has(cursor)) throw new Error('Business inventory cursor repeated');
        seen.add(cursor);
      } while (cursor);
    }
    const originals = [];
    for (const row of rows) originals.push(kind === 'tags' ? row : await call(`get_${kind === 'entities' ? 'entity' : kind.slice(0, -1)}`, { id: row.id }));
    state[kind] = originals.sort((a, b) => a.id.localeCompare(b.id));
  }
  return state;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
