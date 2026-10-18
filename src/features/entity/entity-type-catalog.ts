import type { RequestScope } from "../../lib/api.ts";
import type { EntityType } from "@contracts/entity-type.ts";

/** Invalidation carries only an account and space identity. Consumers read fresh owner data through the API. */
export const entityTypeCatalogEvent = "workspace-entity-type-catalog";
export function invalidateEntityTypeCatalog(scope: RequestScope) {
  window.dispatchEvent(new CustomEvent(entityTypeCatalogEvent, { detail: scope }));
}

type CatalogPage = { items: EntityType[]; next_cursor?: string | null };
/** A read is complete only after every page; cancelled reads never publish partial results. */
export async function readEntityTypeCatalog(
  signal: AbortSignal,
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<CatalogPage>,
) {
  const items: EntityType[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await load(cursor, signal);
    signal.throwIfAborted();
    items.push(...page.items);
    cursor = page.next_cursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error("자료 종류 목록을 끝까지 읽지 못했습니다.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
