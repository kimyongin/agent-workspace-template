import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { ApiError } from "../../lib/api.ts";
import { createDetailResource } from "./detail-resource.ts";

/** Each identity has its own resource; callers retain their existing query refresh policy. */
export function useDetailResource<T>(input: {
  id: string;
  query: string;
  refreshOnQuery: boolean;
  readyAfterFailedRefresh?: boolean;
  load: (id: string, signal: AbortSignal) => Promise<T>;
}) {
  const latest = useRef(input);
  latest.current = input;
  const resource = useMemo(() => createDetailResource<T>({
    load: signal => latest.current.load(input.id, signal),
    readyAfterFailedRefresh: input.readyAfterFailedRefresh,
    isConflict: error => error instanceof ApiError && error.code === "conflict",
  }), [input.id]);
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot);
  const previousQuery = useRef(input.query);
  useEffect(() => {
    previousQuery.current = input.query;
    void resource.reload();
    return () => resource.cancel();
  }, [resource]);
  useEffect(() => {
    if (previousQuery.current === input.query) return;
    previousQuery.current = input.query;
    if (input.refreshOnQuery) void resource.reload(true);
  }, [resource, input.query, input.refreshOnQuery]);
  return { ...state, reload: () => resource.reload(), confirm: resource.confirm, save: resource.save, editClosed: resource.editClosed };
}
