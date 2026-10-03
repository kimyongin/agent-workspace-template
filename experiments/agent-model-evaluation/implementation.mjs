// Intentionally broken evaluation input. Never imported by the app.
export function summarize(records, ownerId) {
  const latest = new Map();
  for (const record of records) latest.set(record.id, record);
  return [...latest.values()].filter(record => !record.deleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
