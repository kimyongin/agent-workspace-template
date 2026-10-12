import { useEffect, useState } from "react";
import type { EntityType } from "@contracts/entity-type.ts";
import { api, query } from "../../lib/api.ts";
export function useEntityTypes(scope = "catalog", revision?: unknown) {
  const [catalog, setCatalog] = useState<{ scope: string; types: EntityType[] } | null>(null),
    [error, setError] = useState(false),
    [generation, setGeneration] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog((previous) => previous?.scope === scope ? previous : null);
    setError(false);
    void (async () => {
      const items: EntityType[] = [], seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await api<{ items: EntityType[]; next_cursor?: string | null }>(
          "GET",
          `/entity-types${query({ include_archived: "true", limit: 100, cursor })}`,
          undefined,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
        if (cursor && seen.has(cursor)) throw new Error("자료 종류 목록을 끝까지 읽지 못했습니다.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      setCatalog({ scope, types: items });
    })().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [scope, generation, revision]);
  return {
    types: catalog?.scope === scope ? catalog.types : null,
    error,
    retry: () => setGeneration((value) => value + 1),
  };
}
