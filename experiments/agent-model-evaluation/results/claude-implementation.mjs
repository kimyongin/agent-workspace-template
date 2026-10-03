export function summarize(records, ownerId) {
  const latest = new Map();
  for (const record of records) {
    if (record.ownerId !== ownerId) continue;
    const existing = latest.get(record.id);
    if (!existing || record.revision > existing.revision) {
      latest.set(record.id, record);
    }
  }
  return [...latest.values()]
    .filter(record => !record.deleted)
    .sort((a, b) => {
      const dateCmp = b.updatedAt.localeCompare(a.updatedAt);
      return dateCmp !== 0 ? dateCmp : a.id.localeCompare(b.id);
    });
}
