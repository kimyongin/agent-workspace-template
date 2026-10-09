import { type SearchInput, searchInput, type SearchItem, type SearchResult } from "@contracts/search.ts";
import { createPagedList } from "../collections/paged-list.ts";
import { workspaceSearchScope } from "./search-scope.ts";

/** The public search contract accepts both existing UUIDs and reserved dated IDs. */
export function searchAnchor(hash: string) {
  try {
    const match = /^#search-(task|record|principle)-(.+)$/.exec(decodeURIComponent(hash));
    if (!match) return undefined;
    const parsed = searchInput.shape.anchor.safeParse({ kind: match[1], id: match[2] });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Search owns its mixed identity, metadata and replay policy; page request lifetime is shared. */
export function createSearchRead(
  params: URLSearchParams,
  load: (input: SearchInput & { cursor?: string }, signal: AbortSignal) => Promise<SearchResult>,
) {
  const input = workspaceSearchScope(params);
  let anchor: SearchInput["anchor"];
  const list = createPagedList<SearchItem, SearchResult>({
    maxRestorePages: 1000,
    anchorLookahead: 0,
    restoreRetry: "restart",
    itemKey: (item) => `${item.kind}:${item.id}`,
    get load() {
      const captured = anchor;
      return (cursor: string | undefined, signal: AbortSignal) =>
        load({ ...input, ...(cursor ? { cursor } : captured ? { anchor: captured } : {}) }, signal);
    },
  });
  return {
    snapshot: list.snapshot,
    subscribe: list.subscribe,
    more: list.more,
    retry: list.retry,
    restart: list.refresh,
    cancel: list.cancel,
    restore: (pages: number, hash: string) => {
      anchor = searchAnchor(hash);
      return list.restore(pages, anchor ? `${anchor.kind}:${anchor.id}` : undefined);
    },
  };
}
