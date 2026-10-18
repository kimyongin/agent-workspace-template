import { useApi, useRequestScope, sameRequestScope } from "../../lib/api-context.tsx";
import { entityTypeCatalogEvent, readEntityTypeCatalog } from "./entity-type-catalog.ts";
import { useContext, useEffect, useMemo, useState } from "react";
import { useWorkspaceCapabilities } from "../workspaces/workspace-context.tsx";
import type { EntityType } from "@contracts/entity-type.ts";
import { AuthContext } from "../auth/auth-context.ts";
import { query } from "../../lib/api.ts";
export function useEntityTypes(revision?: unknown, enabled = true) {
  const api = useApi(), capabilities = useWorkspaceCapabilities();
  const { session } = useContext(AuthContext);
  const requestScope = useRequestScope();
  const scope = enabled && requestScope.workspaceId ? `${session?.user.id}:${requestScope.workspaceId}` : null;
  const [catalog, setCatalog] = useState<{ scope: string; types: EntityType[] } | null>(null),
    [error, setError] = useState<string | null>(null),
    [generation, setGeneration] = useState(0);
  useEffect(() => {
    const refresh = () => { if (scope) setGeneration((value) => value + 1); };
    const changed = (event: Event) => {
      if (sameRequestScope(event, requestScope)) refresh();
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
      if (!controller.signal.aborted) { setCatalog(null); setError(scope); }
    });
    return () => controller.abort();
  }, [scope, generation, revision]);
  const types = useMemo(() => {
    if (!scope || catalog?.scope !== scope) return null;
    return catalog.types.filter(type => capabilities?.grants.some(grant =>
      (grant.access === "read" || grant.access === "write") &&
      (grant.target_kind === "settings" && grant.target_id === "*" ||
        grant.target_kind === "entity_type" && grant.target_id === type.id)));
  }, [scope, catalog, capabilities]);
  return {
    types,
    error: !!scope && error === scope,
    retry: () => setGeneration((value) => value + 1),
  };
}
