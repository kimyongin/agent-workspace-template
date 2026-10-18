import { useApi } from "../../lib/api-context.tsx";
import { entityTypeCatalogEvent, readEntityTypeCatalog } from "./entity-type-catalog.ts";
import { useContext, useEffect, useState } from "react";
import type { EntityType } from "@contracts/entity-type.ts";
import { AuthContext } from "../auth/auth-context.ts";
import { query } from "../../lib/api.ts";
export function useEntityTypes(revision?: unknown, enabled = true) {
  const api = useApi();
  const { session } = useContext(AuthContext);
  const scope = enabled ? session?.user.id ?? null : null;
  const [catalog, setCatalog] = useState<{ scope: string; types: EntityType[] } | null>(null),
    [error, setError] = useState<string | null>(null),
    [generation, setGeneration] = useState(0);
  useEffect(() => {
    const refresh = () => { if (scope) setGeneration((value) => value + 1); };
    const changed = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail === scope) refresh();
    };
    window.addEventListener(entityTypeCatalogEvent, changed);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(entityTypeCatalogEvent, changed);
      window.removeEventListener("focus", refresh);
    };
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog((previous) => previous?.scope === scope ? previous : null);
    setError(null);
    if (!scope) return () => controller.abort();
    void readEntityTypeCatalog(controller.signal, (cursor, signal) =>
      api<{ items: EntityType[]; next_cursor?: string | null }>(
        "GET", `/entity-types${query({ include_archived: "true", limit: 100, cursor })}`, undefined, signal,
      )).then((types) => {
      if (!controller.signal.aborted) setCatalog({ scope, types });
    }).catch(() => {
      if (!controller.signal.aborted) setError(scope);
    });
    return () => controller.abort();
  }, [scope, generation, revision]);
  return {
    types: scope && catalog?.scope === scope ? catalog.types : null,
    error: !!scope && error === scope,
    retry: () => setGeneration((value) => value + 1),
  };
}
