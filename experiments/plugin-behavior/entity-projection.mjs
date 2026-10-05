const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Only these get_entity derived fields may follow the independently read rows.
export function entityProjectionMatches(entity, state, previous = entity) {
  return ['tasks', 'records', 'principles'].every(kind => {
    if (previous[kind] === undefined && entity[kind] === undefined) return true;
    const related = state[kind].filter(row => kind === 'principles' ? row.entity_id === entity.id : row.entity_ids?.includes(entity.id));
    const items = related.toSorted((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id)).slice(0, 5).map(({ id, title, updated_at }) => ({ id, title, updated_at }));
    return equal(entity[kind], { count: related.length, items });
  });
}
