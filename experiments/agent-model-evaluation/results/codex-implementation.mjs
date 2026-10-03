// Intentionally broken evaluation input. Never imported by the app.
export function summarize(records, ownerId) {
  const latest = new Map();
  for (const record of records) {
    if (record.ownerId !== ownerId) continue;

    const current = latest.get(record.id);
    if (!current || record.revision > current.revision) latest.set(record.id, record);
  }

  return [...latest.values()]
    .filter(record => !record.deleted)
    .sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      if (a.id === b.id) return 0;
      return a.id < b.id ? -1 : 1;
    });
}
