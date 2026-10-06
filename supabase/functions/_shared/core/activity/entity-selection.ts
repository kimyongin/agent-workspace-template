/** Omission preserves selection; an explicit empty selection clears it. */
export function selectedEntities(value: { entity_ids?: string[] }): string[] | undefined {
  return value.entity_ids;
}
export function entityChanges(value: { entity_ids?: string[] }) {
  const ids = selectedEntities(value);
  return ids === undefined ? {} : { entity_ids: ids };
}
