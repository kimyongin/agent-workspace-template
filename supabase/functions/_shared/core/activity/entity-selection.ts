/** Omission preserves selection; an explicit empty selection clears it. */
export function selectedEntities(value: { entity_id?: string | null; entity_ids?: string[] }): string[] | undefined {
  return value.entity_ids ?? (value.entity_id === undefined ? undefined : value.entity_id ? [value.entity_id] : []);
}
export function entityChanges(value: { entity_id?: string | null; entity_ids?: string[] }) {
  const ids = selectedEntities(value);
  return ids === undefined ? {} : { entity_ids: ids, entity_id: ids[0] ?? null };
}
