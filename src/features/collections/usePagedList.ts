import { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { WorkspaceContext } from "../details/workspace-context.ts";
import { createPagedList, type ListPage } from "./paged-list.ts";

/** Callback identity is not query identity. Each scope owns one cancellable list session. */
export function usePagedList<T extends { id: string }, P extends ListPage<T>>(input: {
  scope: string;
  pages: number;
  anchor?: string;
  anchorLookahead?: number;
  restoreRetry?: "restart" | "resume";
  retainOnDecrease?: boolean;
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<P>;
}) {
  const revision = useContext(WorkspaceContext)?.revision;
  const previousRevision = useRef(revision);
  const latest = useRef(input);
  latest.current = input;
  const session = useMemo(() => {
    // Read the latest loader when an operation begins, then keep that adapter throughout its replay.
    const scopeInput = latest.current;
    return createPagedList<T, P>({ ...scopeInput,
      get load() { return latest.current.load; } });
  }, [input.scope]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => { void session.restore(input.pages, input.anchor); }, [session, input.pages, input.anchor]);
  useEffect(() => {
    if (previousRevision.current !== revision) { previousRevision.current = revision; void session.refresh(); }
  }, [session, revision]);
  useEffect(() => () => session.cancel(), [session]);
  return { ...state, more: session.more, retry: session.retry };
}
