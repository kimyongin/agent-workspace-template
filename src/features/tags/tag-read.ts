import type { TagResult } from "@contracts/tag.ts";

type Scope = TagResult["scope"];
type Page = { items: TagResult[]; next_cursor: string | null };

/** Scope-local reads own traversal; callers own their selection, baseline and visible lifecycle. */
export function createTagRead(request: (method: "GET", path: string, body: undefined, signal?: AbortSignal) => Promise<Page>) {
  async function* pages(scope: Scope, signal?: AbortSignal) {
    let cursor: string | null = null;
    do {
      signal?.throwIfAborted();
      const page: Page = await request(
        "GET",
        `/tags?scope=${scope}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        signal,
      );
      signal?.throwIfAborted();
      yield page.items;
      cursor = page.next_cursor;
    } while (cursor);
  }
  return {
    async all(scope: Scope, signal?: AbortSignal): Promise<TagResult[]> {
      const tags: TagResult[] = [];
      for await (const items of pages(scope, signal)) tags.push(...items);
      return tags;
    },
    async find(scope: Scope, id: string, signal?: AbortSignal): Promise<TagResult | null> {
      for await (const items of pages(scope, signal)) {
        const found = items.find((tag) => tag.id === id);
        if (found) return found;
      }
      return null;
    },
  };
}
