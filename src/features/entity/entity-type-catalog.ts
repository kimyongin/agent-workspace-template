/** Invalidation carries only an account ID. Consumers read fresh owner data through the API. */
export const entityTypeCatalogEvent = "workspace-entity-type-catalog";
export function invalidateEntityTypeCatalog(ownerId: string) {
  window.dispatchEvent(new CustomEvent(entityTypeCatalogEvent, { detail: ownerId }));
}
