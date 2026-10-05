import { createHash } from 'node:crypto';
function publicPage(payload) {
  if (typeof payload === 'string') { try { return publicPage(JSON.parse(payload)); } catch { return null; } }
  if (!payload || typeof payload !== 'object' || payload.isError) return null;
  if (Array.isArray(payload.items) && ['ok', 'keyword_fallback'].includes(payload.search_state) && Number.isInteger(payload.semantic_coverage?.pending) && Number.isInteger(payload.semantic_coverage?.excluded)) return payload;
  for (const value of Object.values(payload)) { const found = publicPage(value); if (found) return found; }
  return null;
}
// Called only for successful completed native search results. Retain no query,
// titles, summaries or bodies. Item identities remain transient until target ID
// is independently known, then collapse them to matched booleans/enum metadata.
export function observeSearch(input, payload, correction) {
  const page = publicPage(payload);
  if (!page) return null;
  const query = typeof input?.query === 'string' ? input.query : null;
  const marker = correction?.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i)?.[0];
  return { requestedMode: ['auto', 'keyword'].includes(input?.mode) ? input.mode : 'unexposed', querySha256: query ? createHash('sha256').update(query).digest('hex') : null, correctionQueried: Boolean(query && correction && (query.includes(correction) || marker && query.includes(marker))), search_state: page.search_state, semantic_coverage: { pending: page.semantic_coverage.pending, excluded: page.semantic_coverage.excluded }, items: page.items.filter(row => row.kind === 'record' && typeof row.id === 'string' && ['keyword', 'semantic', 'both'].includes(row.match) && ['indexed', 'pending', 'excluded'].includes(row.index_state)).map(({ id, match, index_state }) => ({ id, match, index_state })) };
}
export function searchProofForTarget(observation, targetId) {
  const { items, ...safe } = observation;
  const targetMatches = items.filter(row => row.id === targetId).map(({ match, index_state }) => ({ match, index_state }));
  return { ...safe, targetMatched: targetMatches.length > 0, targetMatches };
}
