import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import { createRelatedRead, type RelatedRead } from "./related-read.ts";

/** The HTTP adapter is scoped to a single row; a supplied row resource keeps both reads together. */
export function useRelatedRead<T>(path: string | undefined, options: { probe?: boolean; resource?: RelatedRead<T> } = {}) {
  const own = useMemo(() => createRelatedRead<T>({ load: signal => api("GET", path!, undefined, signal) }), [path]);
  const resource = options.resource ?? own;
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot);
  useEffect(() => {
    if (path && options.probe) void resource.read("probe");
    return () => { if (!options.resource) resource.cancel(); };
  }, [resource, path, options.probe, options.resource]);
  return { resource, ...state };
}
